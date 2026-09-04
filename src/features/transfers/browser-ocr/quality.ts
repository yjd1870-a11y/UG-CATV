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
  recognitionMaximumSide: 2200,
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

export const detectRequestHeaderBottomRatio = (bitmap: ImageBitmap) => {
  const probeWidth = Math.min(360, bitmap.width);
  const probeHeight = Math.max(1, Math.round(bitmap.height * (probeWidth / bitmap.width)));
  const canvas = document.createElement('canvas');
  canvas.width = probeWidth;
  canvas.height = probeHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OCR 양식 위치를 분석할 수 없습니다.');
  context.drawImage(bitmap, 0, 0, probeWidth, probeHeight);
  const pixels = context.getImageData(0, 0, probeWidth, probeHeight).data;
  const xStart = Math.round(probeWidth * 0.02);
  const xEnd = Math.round(probeWidth * 0.98);
  const searchEnd = Math.min(probeHeight - 1, Math.round(probeHeight * 0.24));
  let lastDarkRow = -1;
  let runStart = -1;
  let bestBottom = -1;

  for (let y = 0; y <= searchEnd; y += 1) {
    let darkPixels = 0;
    for (let x = xStart; x < xEnd; x += 2) {
      const pixel = ((y * probeWidth) + x) * 4;
      const luminance = (pixels[pixel] * 0.299) + (pixels[pixel + 1] * 0.587) + (pixels[pixel + 2] * 0.114);
      if (luminance < 105) darkPixels += 1;
    }
    const sampled = Math.max(1, Math.ceil((xEnd - xStart) / 2));
    const isDarkBarRow = darkPixels / sampled >= 0.48;
    if (isDarkBarRow) {
      if (runStart < 0 || y - lastDarkRow > 2) runStart = y;
      lastDarkRow = y;
    } else if (runStart >= 0 && lastDarkRow - runStart >= 3) {
      bestBottom = lastDarkRow;
      runStart = -1;
    } else if (y - lastDarkRow > 2) {
      runStart = -1;
    }
  }
  if (runStart >= 0 && lastDarkRow - runStart >= 3) bestBottom = lastDarkRow;
  canvas.width = 1;
  canvas.height = 1;
  if (bestBottom < 0) return bitmap.width > bitmap.height ? 0.085 : 0.1;
  return Math.max(0.055, Math.min(0.19, (bestBottom + 1) / probeHeight));
};

const jpegExifOrientation = async (file: File) => {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return 1;
  const view = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffd9 || marker === 0xffda) break;
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > view.byteLength) break;
    const exif = offset + 2;
    if (marker === 0xffe1 && length >= 14
      && view.getUint32(exif, false) === 0x45786966 && view.getUint16(exif + 4, false) === 0) {
      const tiff = exif + 6;
      const littleEndian = view.getUint16(tiff, false) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, littleEndian);
      if (ifd + 2 > view.byteLength) return 1;
      const count = view.getUint16(ifd, littleEndian);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + (index * 12);
        if (entry + 12 > view.byteLength) break;
        if (view.getUint16(entry, littleEndian) === 0x0112) {
          const orientation = view.getUint16(entry + 8, littleEndian);
          return orientation >= 1 && orientation <= 8 ? orientation : 1;
        }
      }
    }
    offset += length;
  }
  return 1;
};

const orientedBitmapForFile = async (file: File) => {
  // 일부 브라우저는 createImageBitmap(File)에 휴대폰 JPEG의 EXIF 회전값을
  // 적용하지 않는다. EXIF를 직접 읽고 OCR 전용 canvas에 확정 방향으로 그린다.
  const orientation = await jpegExifOrientation(file);
  const source = await createImageBitmap(file, { imageOrientation: 'none' });
  const rotated = orientation >= 5 && orientation <= 8;
  // Chromium 버전에 따라 imageOrientation: none이어도 EXIF 회전이 이미 적용될
  // 수 있다. 요청등록 문서는 세로 양식이므로 세로 bitmap을 다시 돌리지 않는다.
  const appliedOrientation = rotated && source.height >= source.width ? 1 : orientation;
  const needsDimensionSwap = appliedOrientation >= 5 && appliedOrientation <= 8;
  const sourceWidth = needsDimensionSwap ? source.height : source.width;
  const sourceHeight = needsDimensionSwap ? source.width : source.height;
  const scale = Math.min(1, OCR_QUALITY_CONFIG.recognitionMaximumSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    source.close();
    throw new Error('휴대폰 사진 방향을 보정할 수 없습니다.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const width = source.width * scale;
  const height = source.height * scale;
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    1: [scale, 0, 0, scale, 0, 0],
    2: [-scale, 0, 0, scale, width, 0],
    3: [-scale, 0, 0, -scale, width, height],
    4: [scale, 0, 0, -scale, 0, height],
    5: [0, scale, scale, 0, 0, 0],
    6: [0, scale, -scale, 0, height, 0],
    7: [0, -scale, -scale, 0, height, width],
    8: [0, -scale, scale, 0, 0, width],
  };
  context.setTransform(...transforms[appliedOrientation]);
  context.drawImage(source, 0, 0);
  context.resetTransform();
  source.close();
  const bitmap = await createImageBitmap(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return { bitmap, sourceWidth, sourceHeight };
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
  const { bitmap, sourceWidth, sourceHeight } = await orientedBitmapForFile(file);
  const { canvas, context } = canvasForBitmap(bitmap, OCR_QUALITY_CONFIG.analysisMaximumSide);
  const statistics = imageStatistics(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;

  const warnings: string[] = [];
  let poor = false;
  if (sourceWidth < OCR_QUALITY_CONFIG.hardMinimumWidth || sourceHeight < OCR_QUALITY_CONFIG.hardMinimumHeight) {
    poor = true;
    warnings.push('글자가 너무 작습니다. 화면에 더 가까이 촬영해 주세요.');
  } else if (sourceWidth < OCR_QUALITY_CONFIG.recommendedWidth || sourceHeight < OCR_QUALITY_CONFIG.recommendedHeight) {
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
      width: sourceWidth,
      height: sourceHeight,
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

export type OcrCropRegion = { x: number; y: number; width: number; height: number };

const boundedRegion = (bitmap: ImageBitmap, region: OcrCropRegion) => {
  const x = Math.max(0, Math.min(bitmap.width - 1, Math.round(region.x)));
  const y = Math.max(0, Math.min(bitmap.height - 1, Math.round(region.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(bitmap.width - x, Math.round(region.width))),
    height: Math.max(1, Math.min(bitmap.height - y, Math.round(region.height))),
  };
};

const fieldCanvas = (
  bitmap: ImageBitmap,
  requestedRegion: OcrCropRegion,
  options: {
    contrast: number;
    moireReduction?: boolean;
    moireScale?: number;
    moireBlur?: number;
    edgeMaskRatio?: number;
    verticalBandingCorrection?: boolean;
    binaryThreshold?: number;
  },
) => {
  const region = boundedRegion(bitmap, requestedRegion);
  const scale = Math.min(2.4, 1800 / Math.max(region.width, region.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale) + 24);
  canvas.height = Math.max(1, Math.round(region.height * scale) + 24);
  const context = canvas.getContext('2d', { willReadFrequently: options.verticalBandingCorrection });
  if (!context) throw new Error('OCR 항목 영역 전처리를 실행할 수 없습니다.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  if (options.moireReduction) {
    const reduced = document.createElement('canvas');
    // LCD 촬영 모아레는 1~2px 주기의 세로선이므로 약 1/3 크기로 먼저
    // 축소해 줄무늬를 평균화한 다음 OCR 크기로 확대한다.
    const reductionScale = options.moireScale ?? 0.32;
    reduced.width = Math.max(1, Math.round(region.width * reductionScale));
    reduced.height = Math.max(1, Math.round(region.height * reductionScale));
    const reducedContext = reduced.getContext('2d');
    if (!reducedContext) throw new Error('모아레 완화 전처리를 실행할 수 없습니다.');
    reducedContext.imageSmoothingEnabled = true;
    reducedContext.imageSmoothingQuality = 'high';
    reducedContext.filter = `grayscale(1) blur(${options.moireBlur ?? 0.8}px)`;
    reducedContext.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, reduced.width, reduced.height);
    context.filter = `contrast(${options.contrast})`;
    context.drawImage(reduced, 0, 0, reduced.width, reduced.height, 12, 12, canvas.width - 24, canvas.height - 24);
    reduced.width = 1;
    reduced.height = 1;
  } else {
    context.filter = `grayscale(1) contrast(${options.contrast})`;
    context.drawImage(bitmap, region.x, region.y, region.width, region.height, 12, 12, canvas.width - 24, canvas.height - 24);
  }
  context.filter = 'none';

  if (options.edgeMaskRatio) {
    const edgeHeight = Math.max(1, Math.round(canvas.height * options.edgeMaskRatio));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, edgeHeight);
    context.fillRect(0, canvas.height - edgeHeight, canvas.width, edgeHeight);
  }

  if (options.verticalBandingCorrection) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const source = image.data;
    const columnBackground = new Float32Array(canvas.width);
    let backgroundSum = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      let columnSum = 0;
      let backgroundPixels = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        const value = source[((y * canvas.width) + x) * 4];
        // 글자와 표 선은 제외하고 밝은 배경만 평균내 LCD 세로 줄무늬의
        // 열별 밝기 편차를 추정한다.
        if (value >= 105) {
          columnSum += value;
          backgroundPixels += 1;
        }
      }
      const average = backgroundPixels ? columnSum / backgroundPixels : 255;
      columnBackground[x] = average;
      backgroundSum += average;
    }
    const background = backgroundSum / canvas.width;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const correction = Math.max(-70, Math.min(70, (background - columnBackground[x]) * 1.12));
        const pixel = ((y * canvas.width) + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          source[pixel + channel] = Math.max(0, Math.min(255, source[pixel + channel] + correction));
        }
      }
    }
    if (options.binaryThreshold) {
      for (let pixel = 0; pixel < source.length; pixel += 4) {
        const value = source[pixel] < options.binaryThreshold ? 0 : 255;
        source[pixel] = value;
        source[pixel + 1] = value;
        source[pixel + 2] = value;
      }
    }
    context.putImageData(image, 0, 0);
  }

  return canvas;
};

export const prepareOcrBranchDetailCanvas = (bitmap: ImageBitmap, region: OcrCropRegion) => (
  fieldCanvas(bitmap, region, {
    contrast: 1.22, edgeMaskRatio: 0.08, verticalBandingCorrection: true, binaryThreshold: 105,
  })
);

export const prepareOcrAddressCanvas = (bitmap: ImageBitmap, region: OcrCropRegion) => fieldCanvas(bitmap, region, {
  contrast: 1.2, verticalBandingCorrection: true, binaryThreshold: 135,
});
