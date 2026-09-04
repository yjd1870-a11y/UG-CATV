import { criticalOcrFieldsNeedReview, parseAndValidateOcrText } from './validation';
import {
  detectRequestHeaderBottomRatio, inspectOcrPhotoQuality, prepareOcrAddressCanvas, prepareOcrBranchDetailCanvas,
} from './quality';
import type { BrowserOcrProgress, BrowserOcrResult, OcrFieldName, OcrFieldResult, OcrQualityResult } from './types';

const EMPTY_FIELDS = (): Record<OcrFieldName, OcrFieldResult> => parseAndValidateOcrText('');
const EMPTY_QUALITY: OcrQualityResult = {
  status: 'poor', width: 0, height: 0, brightness: 0, contrast: 0,
  blurScore: 0, glareRatio: 0, darkRatio: 0, warnings: [],
};
const OCR_MODEL_CACHE_PATH = 'catv-work-transfer-ocr-v12-20260903';

let activeRecognitionCancel: (() => void) | null = null;
let activeRecognitionToken: symbol | null = null;
const abortError = () => new DOMException('OCR 작업이 취소되었습니다.', 'AbortError');

const verifyWebAssemblyExecution = async () => {
  try {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch {
    throw new Error('브라우저 보안 설정에서 OCR 실행이 차단되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
  }
};

const modelProgressMessage = (status: string) => {
  if (status === 'loading tesseract core') return '무료 OCR 실행 모듈을 준비하고 있습니다.';
  if (status === 'loading language traineddata') return '기기에 저장된 한글·영문 인식 모델을 불러오고 있습니다.';
  if (status === 'initializing api') return '한글·영문 OCR을 초기화하고 있습니다.';
  return '무료 한글·영문 OCR 모델을 브라우저에서 준비하고 있습니다.';
};

const templateRegions = (bitmap: ImageBitmap) => {
  // 촬영자가 브라우저 상단을 얼마나 포함했는지에 따라 모든 행의 Y 좌표가
  // 달라진다. 검은 '요청등록' 바의 하단을 기준점으로 삼아 값 행을 찾는다.
  const headerBottom = detectRequestHeaderBottomRatio(bitmap);
  const landscape = bitmap.width > bitmap.height;
  const expandedHeader = !landscape && headerBottom > 0.13;
  const branchX = landscape ? 0.135 : 0.17;
  const branchY = headerBottom + (expandedHeader ? 0.006 : 0.004);
  const addressY = headerBottom + (expandedHeader ? 0.285 : landscape ? 0.31 : 0.335);
  return {
    branch: { x: bitmap.width * branchX, y: bitmap.height * branchY, width: bitmap.width * 0.5, height: bitmap.height * 0.065 },
    address: { x: bitmap.width * (landscape ? 0.135 : 0.205), y: bitmap.height * addressY, width: bitmap.width * (landscape ? 0.855 : 0.785), height: bitmap.height * 0.075 },
    addressTail: { x: bitmap.width * 0.62, y: bitmap.height * addressY, width: bitmap.width * 0.37, height: bitmap.height * 0.075 },
  };
};

export const recognizeWorkTransferPhotoInBrowser = async (
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: BrowserOcrProgress) => void } = {},
): Promise<BrowserOcrResult> => {
  activeRecognitionCancel?.();
  const recognitionToken = Symbol('work-transfer-ocr');
  activeRecognitionToken = recognitionToken;
  let cancelled = false;
  let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;
  let bitmap: ImageBitmap | null = null;
  const canvases: HTMLCanvasElement[] = [];
  const cancelRecognition = () => {
    cancelled = true;
    void worker?.terminate().catch(() => undefined);
  };
  const ensureActive = () => {
    if (cancelled || options.signal?.aborted) throw abortError();
  };
  activeRecognitionCancel = cancelRecognition;
  options.signal?.addEventListener('abort', cancelRecognition, { once: true });

  try {
    ensureActive();
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      throw new Error('이 브라우저에서는 OCR을 실행할 수 없습니다. 브라우저를 업데이트하거나 직접 입력해 주세요.');
    }
    await verifyWebAssemblyExecution();
    options.onProgress?.({ stage: 'quality', progress: 0.05, message: '사진 품질을 확인하고 있습니다.' });
    const inspected = await inspectOcrPhotoQuality(file);
    bitmap = inspected.bitmap;
    options.onProgress?.({ stage: 'model', progress: 0.12, message: '무료 한글·영문 OCR 모델을 준비하고 있습니다.' });
    let tesseractModule: typeof import('tesseract.js') | null = null;
    let passProgress = { start: 0.2, span: 0.18, message: '지점명을 인식하고 있습니다.' };
    const workerPromise = (async () => {
      tesseractModule = await import('tesseract.js');
      ensureActive();
      const { createWorker, OEM } = tesseractModule;
      const createdWorker = await createWorker('kor+eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/tesseract/worker.min.js',
        corePath: '/ocr/tesseract-core/tesseract-core-lstm.wasm.js',
        langPath: '/ocr/lang-v9', gzip: true, cachePath: OCR_MODEL_CACHE_PATH, cacheMethod: 'write',
        logger: (message) => {
          if (message.status === 'recognizing text') {
            const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
            options.onProgress?.({
              stage: 'recognition', progress: passProgress.start + (progress * passProgress.span),
              message: `${passProgress.message} ${Math.round(progress * 100)}%`,
            });
          } else {
            options.onProgress?.({ stage: 'model', progress: 0.12, message: modelProgressMessage(message.status) });
          }
        },
      });
      if (cancelled || options.signal?.aborted) {
        await createdWorker.terminate().catch(() => undefined);
        throw abortError();
      }
      return createdWorker;
    })();
    let timeoutId = 0;
    let abortListener: (() => void) | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('OCR 모델 준비 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.')), 150_000);
      });
      const abortPromise = new Promise<never>((_, reject) => {
        abortListener = () => reject(abortError());
        options.signal?.addEventListener('abort', abortListener, { once: true });
      });
      worker = await Promise.race([workerPromise, timeoutPromise, abortPromise]);
    } catch (error) {
      void workerPromise.then((pendingWorker) => pendingWorker.terminate()).catch(() => undefined);
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
    }

    try {
      if (!tesseractModule) throw abortError();
      ensureActive();
      const regions = templateRegions(bitmap);
      const textParts: string[] = [];
      const recognitionConfidences: number[] = [];

      passProgress = { start: 0.2, span: 0.2, message: '지점명을 인식하고 있습니다.' };
      const branchCanvas = prepareOcrBranchDetailCanvas(bitmap, regions.branch);
      canvases.push(branchCanvas);
      await worker.setParameters({
        tessedit_pageseg_mode: tesseractModule.PSM.SINGLE_LINE,
        tessedit_char_whitelist: '', preserve_interword_spaces: '1',
      });
      const branchResult = await worker.recognize(branchCanvas);
      ensureActive();
      textParts.push('[지점 영역 재검사]', branchResult.data.text.trim());
      recognitionConfidences.push(branchResult.data.confidence);

      let fields = parseAndValidateOcrText(textParts.join('\n'));
      let addressBaseText = '';

      for (const index of [1, 2] as const) {
        ensureActive();
        passProgress = index === 1
          ? { start: 0.4, span: 0.4, message: '고객주소의 모아레를 보정하고 있습니다.' }
          : { start: 0.8, span: 0.13, message: '고객주소 끝부분을 교차 확인하고 있습니다.' };
        const addressCanvas = index === 2
          ? prepareOcrBranchDetailCanvas(bitmap, regions.addressTail)
          : prepareOcrAddressCanvas(bitmap, regions.address);
        canvases.push(addressCanvas);
        await worker.setParameters({
          tessedit_pageseg_mode: tesseractModule.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: '',
          tessedit_char_blacklist: '',
          preserve_interword_spaces: '1',
        });
        const addressResult = await worker.recognize(addressCanvas);
        ensureActive();
        const recognizedAddress = addressResult.data.text.trim();
        if (index === 1) addressBaseText = recognizedAddress;
        let addressCandidate = recognizedAddress;
        if (index === 2) {
          const cleanBase = addressBaseText.replace(/\s+[A-Za-z]{2,8}[\]\\:;,.]*$/, '').trim();
          const baseHasLotNumber = /\[[가-힣]{1,12}\s*,\s*\d+(?:-\d+)?\s*\]?/.test(cleanBase);
          const bracketed = recognizedAddress.match(/\[[가-힣]{1,12}\s*,\s*\d+(?:-\d+)?\s*\]?/)?.[0] || '';
          const loose = recognizedAddress.match(/([가-힣]{1,12})[\s,]*(\d+(?:-\d+)?)/);
          const recognizedNumbers: string[] = recognizedAddress.match(/\d+(?:-\d+)?/g) ?? [];
          const numberOnly = recognizedNumbers.find((value: string) => value.includes('-')) || recognizedNumbers[recognizedNumbers.length - 1] || '';
          const roadVillage = cleanBase.match(/([가-힣]+)\d*리길/)?.[1];
          const basePlace = cleanBase.match(/\(([^),\s]+(?:동|리))[^)]*\)/)?.[1] || (roadVillage ? `${roadVillage}리` : '');
          const reconstructed = baseHasLotNumber ? '' : bracketed
            || (loose ? `[${loose[1]},${loose[2]}]` : '')
            || (numberOnly && basePlace ? `[${basePlace},${numberOnly}]` : '');
          const baseWithoutBrokenLot = reconstructed ? cleanBase.replace(/\s*\[[^\n]*$/, '').trim() : cleanBase;
          addressCandidate = `${baseWithoutBrokenLot} ${reconstructed}`.trim();
        }
        textParts.push(`[주소 후보 ${String.fromCharCode(65 + index)} 영역 재검사]`, addressCandidate);
        recognitionConfidences.push(addressResult.data.confidence);
        fields = parseAndValidateOcrText(textParts.join('\n'));
        if (index === 1 && fields.customerAddress.validationStatus === 'valid') break;
      }

      const text = textParts.join('\n').trim();
      options.onProgress?.({ stage: 'validation', progress: 0.96, message: '지점과 고객주소의 관할 및 OCR 후보 일치 여부를 검증하고 있습니다.' });
      fields = parseAndValidateOcrText(text);
      const confidence = Number((recognitionConfidences.reduce((sum, value) => sum + value, 0) / (recognitionConfidences.length * 100)).toFixed(3));
      if (!fields.branchName.value && !fields.customerAddress.value) {
        return {
          engine: 'browser-tesseract-kor-eng', status: 'failed', text, confidence,
          quality: inspected.quality, fields, requiresReview: true,
          errorMessage: '지점과 고객주소를 인식하지 못했습니다. 다시 촬영하거나 직접 입력해 주세요.',
        };
      }
      return {
        engine: 'browser-tesseract-kor-eng', status: 'succeeded', text, confidence,
        quality: inspected.quality, fields,
        requiresReview: inspected.quality.status === 'poor' || criticalOcrFieldsNeedReview(fields),
      };
    } finally {
      ensureActive();
    }
  } catch (error) {
    if (cancelled || options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
    return {
      engine: 'browser-tesseract-kor-eng', status: 'failed', text: '', confidence: 0,
      quality: EMPTY_QUALITY, fields: EMPTY_FIELDS(), requiresReview: true,
      errorMessage: error instanceof Error ? error.message : '브라우저 OCR을 실행하지 못했습니다.',
    };
  } finally {
    for (const canvas of canvases) canvas.remove();
    bitmap?.close();
    await worker?.terminate().catch(() => undefined);
    options.signal?.removeEventListener('abort', cancelRecognition);
    if (activeRecognitionToken === recognitionToken) {
      activeRecognitionCancel = null;
      activeRecognitionToken = null;
    }
  }
};

export type { BrowserOcrResult, BrowserOcrProgress, OcrFieldResult } from './types';
