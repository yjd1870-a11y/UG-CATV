import { criticalOcrFieldsNeedReview, parseAndValidateOcrText } from './validation';
import {
  inspectOcrPhotoQuality, prepareOcrAddressCanvas, prepareOcrCanvas,
  prepareOcrPreActionCanvas, prepareOcrRequestDetailsCanvas,
} from './quality';
import type { BrowserOcrProgress, BrowserOcrResult, OcrFieldName, OcrFieldResult, OcrQualityResult } from './types';

const EMPTY_FIELDS = (): Record<OcrFieldName, OcrFieldResult> => parseAndValidateOcrText('');
const EMPTY_QUALITY: OcrQualityResult = {
  status: 'poor', width: 0, height: 0, brightness: 0, contrast: 0,
  blurScore: 0, glareRatio: 0, darkRatio: 0, warnings: [],
};

let recognitionInProgress = false;

const abortError = () => new DOMException('OCR 작업이 취소되었습니다.', 'AbortError');

const modelProgressMessage = (status: string) => {
  if (status === 'loading tesseract core') return '무료 OCR 실행 모듈을 준비하고 있습니다.';
  if (status === 'loading language traineddata') return '기기에 저장된 한글·영문 인식 모델을 불러오고 있습니다.';
  if (status === 'initializing api') return '한글·영문 OCR을 초기화하고 있습니다.';
  return '무료 한글·영문 OCR 모델을 브라우저에서 준비하고 있습니다.';
};

export const recognizeWorkTransferPhotoInBrowser = async (
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: BrowserOcrProgress) => void } = {},
): Promise<BrowserOcrResult> => {
  if (recognitionInProgress) throw new Error('다른 OCR 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  recognitionInProgress = true;
  let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let addressCanvas: HTMLCanvasElement | null = null;
  let preActionCanvas: HTMLCanvasElement | null = null;
  let requestDetailsCanvas: HTMLCanvasElement | null = null;

  try {
    if (options.signal?.aborted) throw abortError();
    options.onProgress?.({ stage: 'quality', progress: 0.05, message: '사진 품질을 확인하고 있습니다.' });
    const inspected = await inspectOcrPhotoQuality(file);
    bitmap = inspected.bitmap;
    options.onProgress?.({ stage: 'model', progress: 0.12, message: '무료 한글·영문 OCR 모델을 브라우저에서 준비하고 있습니다.' });
    let tesseractModule: typeof import('tesseract.js') | null = null;
    const workerPromise = (async () => {
      tesseractModule = await import('tesseract.js');
      if (options.signal?.aborted) throw abortError();
      options.onProgress?.({ stage: 'model', progress: 0.13, message: 'OCR 실행 Worker를 시작하고 있습니다.' });
      const { createWorker, OEM } = tesseractModule;
      return createWorker('kor+eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/tesseract/worker.min.js',
        // An explicit non-SIMD core avoids a slow feature-detection branch on
        // older field devices and keeps the runtime entirely same-origin.
        corePath: '/ocr/tesseract-core/tesseract-core-lstm.wasm.js',
        langPath: '/ocr/lang',
        gzip: true,
        cacheMethod: 'write',
        logger: (message) => {
          if (message.status === 'recognizing text') {
            options.onProgress?.({
              stage: 'recognition',
              progress: 0.2 + (Math.max(0, Math.min(1, Number(message.progress) || 0)) * 0.68),
              message: `사진에서 텍스트를 인식하고 있습니다. ${Math.round((Number(message.progress) || 0) * 100)}%`,
            });
          } else {
            options.onProgress?.({
              stage: 'model',
              progress: 0.12 + (Math.max(0, Math.min(1, Number(message.progress) || 0)) * 0.06),
              message: modelProgressMessage(message.status),
            });
          }
        },
      });
    })();
    let timeoutId = 0;
    let abortListener: (() => void) | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('OCR 모델 준비 시간이 초과되었습니다. 다시 시도해 주세요.')), 90_000);
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

    const terminateOnAbort = () => { void worker?.terminate(); };
    options.signal?.addEventListener('abort', terminateOnAbort, { once: true });
    try {
      if (options.signal?.aborted) throw abortError();
      if (!tesseractModule) throw new Error('OCR 라이브러리를 초기화하지 못했습니다.');
      await worker.setParameters({ tessedit_pageseg_mode: tesseractModule.PSM.AUTO, preserve_interword_spaces: '1' });
      canvas = prepareOcrCanvas(bitmap);
      const result = await worker.recognize(canvas);
      if (options.signal?.aborted) throw abortError();
      let text = result.data.text.trim();
      options.onProgress?.({ stage: 'validation', progress: 0.94, message: '서비스번호·날짜·주소 형식을 검증하고 있습니다.' });
      let fields = parseAndValidateOcrText(text);
      let resultConfidence = result.data.confidence;
      // 짧게 잘린 주소도 글자 수 검증은 통과하므로 유효 여부와 관계없이
      // 주소와 사전조치 행을 확대 재검사한다. 모든 처리는 브라우저 내부에서만 수행된다.
      options.onProgress?.({ stage: 'recognition', progress: 0.88, message: '주소 영역을 정밀 확인하고 있습니다.' });
      await worker.setParameters({ tessedit_pageseg_mode: tesseractModule.PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      addressCanvas = prepareOcrAddressCanvas(bitmap);
      const addressResult = await worker.recognize(addressCanvas);
      if (options.signal?.aborted) throw abortError();
      const focusedAddressText = addressResult.data.text.trim();
      if (focusedAddressText) text = `${text}\n\n[주소 영역 재검사]\n${focusedAddressText}`;
      resultConfidence = Math.max(resultConfidence, addressResult.data.confidence);

      options.onProgress?.({ stage: 'recognition', progress: 0.92, message: '사전조치내용 영역을 정밀 확인하고 있습니다.' });
      await worker.setParameters({ tessedit_pageseg_mode: tesseractModule.PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      preActionCanvas = prepareOcrPreActionCanvas(bitmap);
      const preActionResult = await worker.recognize(preActionCanvas);
      if (options.signal?.aborted) throw abortError();
      const focusedPreActionText = preActionResult.data.text.trim();
      if (focusedPreActionText) text = `${text}\n\n[사전조치 영역 재검사]\n${focusedPreActionText}`;

      options.onProgress?.({ stage: 'recognition', progress: 0.95, message: '점검요청내용 영역을 정밀 확인하고 있습니다.' });
      requestDetailsCanvas = prepareOcrRequestDetailsCanvas(bitmap);
      const requestDetailsResult = await worker.recognize(requestDetailsCanvas);
      if (options.signal?.aborted) throw abortError();
      const focusedRequestDetailsText = requestDetailsResult.data.text.trim();
      if (focusedRequestDetailsText) text = `${text}\n\n[점검요청 영역 재검사]\n${focusedRequestDetailsText}`;
      fields = parseAndValidateOcrText(text);
      resultConfidence = Math.max(resultConfidence, preActionResult.data.confidence, requestDetailsResult.data.confidence);
      const confidence = Number((Math.max(0, Math.min(100, resultConfidence)) / 100).toFixed(3));
      if (!text) {
        return {
          engine: 'browser-tesseract-kor-eng', status: 'failed', text: '', confidence,
          quality: inspected.quality, fields, requiresReview: true,
          errorMessage: '사진에서 텍스트를 인식하지 못했습니다. 다시 촬영하거나 직접 입력해 주세요.',
        };
      }
      return {
        engine: 'browser-tesseract-kor-eng', status: 'succeeded', text, confidence,
        quality: inspected.quality, fields,
        requiresReview: confidence < 0.9 || inspected.quality.status !== 'good' || criticalOcrFieldsNeedReview(fields),
      };
    } finally {
      options.signal?.removeEventListener('abort', terminateOnAbort);
    }
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
    return {
      engine: 'browser-tesseract-kor-eng', status: 'failed', text: '', confidence: 0,
      quality: EMPTY_QUALITY, fields: EMPTY_FIELDS(), requiresReview: true,
      errorMessage: error instanceof Error ? error.message : '브라우저 OCR을 실행하지 못했습니다.',
    };
  } finally {
    canvas?.remove();
    addressCanvas?.remove();
    preActionCanvas?.remove();
    requestDetailsCanvas?.remove();
    bitmap?.close();
    await worker?.terminate().catch(() => undefined);
    recognitionInProgress = false;
  }
};

export type { BrowserOcrResult, BrowserOcrProgress, OcrFieldResult } from './types';
