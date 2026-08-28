import type { OcrQualityResult } from './types';

export const OCR_QUALITY_CONFIG = Object.freeze({
  hardMinimumWidth: 600,
  hardMinimumHeight: 320,
  recommendedWidth: 1200,
  recommendedHeight: 600,
  hardMinimumBrightness: 18,
  hardMaximumBrightness: 242,
  recommendedMinimumBrightness: 42,
  recommendedMaximumBrightness: 222,
  hardMinimumContrast: 8,
  recommendedMinimumContrast: 20,
  hardMinimumBlurScore: 8,
  recommendedMinimumBlurScore: 28,
  warningGlareRatio: 0.18,
  warningDarkRatio: 0.28,
  analysisMaximumSide: 960,
  recognitionMaximumSide: 2400,
  recognitionMinimumLongSide: 1800,
});

const canvasForBitmap = (bitmap: ImageBitmap, maximumSide: number) => {
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('브라우저 이미지 처리 기능을 사용할 수 없습니다.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
};

const imageStatistics = (data: Uint8ClampedArray, width: number, height: number) => {
  const grayscale = new Uint8Array(width * height);
  let sum = 0;
  let squaredSum = 0;
  let glarePixels = 0;
  let darkPixels = 0;

  for (let pixel = 0, grayIndex = 0; pixel < data.length; pixel += 4, grayIndex += 1) {
    const gray = Math.round((data[pixel] * 0.299) + (data[pixel + 1] * 0.587) + (data[pixel + 2] * 0.114));
    grayscale[grayIndex] = gray;
    sum += gray;
    squaredSum += gray * gray;
    if (gray >= 248) glarePixels += 1;
    if (gray <= 22) darkPixels += 1;
  }

  const count = grayscale.length || 1;
  const brightness = sum / count;
  const contrast = Math.sqrt(Math.max(0, (squaredSum / count) - (brightness * brightness)));
  let laplacianSum = 0;
  let laplacianSquaredSum = 0;
  let laplacianCount = 0;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = (y * width) + x;
      const laplacian = (4 * grayscale[index])
        - grayscale[index - 1]
        - grayscale[index + 1]
        - grayscale[index - width]
        - grayscale[index + width];
      laplacianSum += laplacian;
      laplacianSquaredSum += laplacian * laplacian;
      laplacianCount += 1;
    }
  }

  const laplacianMean = laplacianSum / Math.max(1, laplacianCount);
  const blurScore = Math.sqrt(Math.max(0, (laplacianSquaredSum / Math.max(1, laplacianCount)) - (laplacianMean ** 2)));
  return {
    brightness,
    contrast,
    blurScore,
    glareRatio: glarePixels / count,
    darkRatio: darkPixels / count,
  };
};

export const inspectOcrPhotoQuality = async (file: File): Promise<{ bitmap: ImageBitmap; quality: OcrQualityResult }> => {
  const bitmap = await createImageBitmap(file);
  const { canvas, context } = canvasForBitmap(bitmap, OCR_QUALITY_CONFIG.analysisMaximumSide);
  const statistics = imageStatistics(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;

  const warnings: string[] = [];
  let poor = false;
  if (bitmap.width < OCR_QUALITY_CONFIG.hardMinimumWidth || bitmap.height < OCR_QUALITY_CONFIG.hardMinimumHeight) {
    poor = true;
    warnings.push('글자가 너무 작습니다. 화면에 더 가까이 촬영해 주세요.');
  } else if (bitmap.width < OCR_QUALITY_CONFIG.recommendedWidth || bitmap.height < OCR_QUALITY_CONFIG.recommendedHeight) {
    warnings.push('사진 해상도가 낮아 일부 글자는 확인이 필요할 수 있습니다.');
  }
  if (statistics.brightness < OCR_QUALITY_CONFIG.hardMinimumBrightness || statistics.brightness > OCR_QUALITY_CONFIG.hardMaximumBrightness) {
    poor = true;
    warnings.push('화면이 너무 어둡거나 밝아 글자를 판독하기 어렵습니다.');
  } else if (statistics.brightness < OCR_QUALITY_CONFIG.recommendedMinimumBrightness || statistics.brightness > OCR_QUALITY_CONFIG.recommendedMaximumBrightness) {
    warnings.push('화면 밝기가 고르지 않아 인식 결과를 확인해 주세요.');
  }
  if (statistics.contrast < OCR_QUALITY_CONFIG.hardMinimumContrast) {
    poor = true;
    warnings.push('글자와 배경의 대비가 너무 낮습니다.');
  } else if (statistics.contrast < OCR_QUALITY_CONFIG.recommendedMinimumContrast) {
    warnings.push('글자 대비가 낮아 인식 결과를 확인해 주세요.');
  }
  if (statistics.blurScore < OCR_QUALITY_CONFIG.hardMinimumBlurScore) {
    poor = true;
    warnings.push('사진이 흐려 글자를 판독하기 어렵습니다. 초점을 맞춘 후 다시 촬영해 주세요.');
  } else if (statistics.blurScore < OCR_QUALITY_CONFIG.recommendedMinimumBlurScore) {
    warnings.push('사진이 약간 흐립니다. 서비스번호와 주소를 확인해 주세요.');
  }
  if (statistics.glareRatio > OCR_QUALITY_CONFIG.warningGlareRatio) warnings.push('화면 반사가 감지되었습니다. 반사된 부분의 글자를 확인해 주세요.');
  if (statistics.darkRatio > OCR_QUALITY_CONFIG.warningDarkRatio) warnings.push('어두운 영역이 많습니다. 누락된 글자가 없는지 확인해 주세요.');

  return {
    bitmap,
    quality: {
      status: poor ? 'poor' : warnings.length ? 'acceptable' : 'good',
      width: bitmap.width,
      height: bitmap.height,
      brightness: Number(statistics.brightness.toFixed(1)),
      contrast: Number(statistics.contrast.toFixed(1)),
      blurScore: Number(statistics.blurScore.toFixed(1)),
      glareRatio: Number(statistics.glareRatio.toFixed(3)),
      darkRatio: Number(statistics.darkRatio.toFixed(3)),
      warnings,
    },
  };
};

export const prepareOcrCanvas = (bitmap: ImageBitmap) => {
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(
    3,
    OCR_QUALITY_CONFIG.recognitionMaximumSide / longSide,
    Math.max(1, OCR_QUALITY_CONFIG.recognitionMinimumLongSide / longSide),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('브라우저 이미지 전처리를 실행할 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.18)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  context.filter = 'none';
  return canvas;
};

export const prepareOcrPreActionCanvas = (bitmap: ImageBitmap) => {
  // 표의 라벨 열을 제외하고 값 열만 확대한다. 라벨과 아래 점검요청 행까지
  // 함께 읽으면 Tesseract가 열 순서를 섞어 사전조치 값에 다른 문구를 합친다.
  const sourceX = Math.round(bitmap.width * 0.17);
  const sourceY = Math.round(bitmap.height * 0.68);
  const sourceWidth = Math.round(bitmap.width * 0.82);
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.round(bitmap.height * 0.2));
  const scale = Math.min(3.4, 3000 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사전조치 영역 전처리를 실행할 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.26)';
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  context.filter = 'none';
  return canvas;
};

export const prepareOcrRequestDetailsCanvas = (bitmap: ImageBitmap) => {
  // 하단 점검요청 값 열만 분리해 번호와 기술용어의 읽기 순서를 보존한다.
  const sourceX = Math.round(bitmap.width * 0.17);
  const sourceY = Math.round(bitmap.height * 0.79);
  const sourceWidth = Math.round(bitmap.width * 0.82);
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.round(bitmap.height * 0.19));
  const scale = Math.min(3.5, 3000 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('점검요청내용 영역 전처리를 실행할 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.3)';
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  context.filter = 'none';
  return canvas;
};

export const prepareOcrAddressCanvas = (bitmap: ImageBitmap) => {
  // 긴 주소는 전체 화면 OCR에서 글자 크기가 작아지며 오른쪽 괄호·번지부터
  // 잘리는 경우가 있으므로 라벨부터 행의 우측 끝까지 별도로 확대한다.
  const sourceX = Math.round(bitmap.width * 0.01);
  const sourceY = Math.round(bitmap.height * 0.4);
  const sourceWidth = Math.round(bitmap.width * 0.98);
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.round(bitmap.height * 0.22));
  const scale = Math.min(3.2, 2800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('주소 영역 전처리를 실행할 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.38)';
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  context.filter = 'none';
  return canvas;
};
