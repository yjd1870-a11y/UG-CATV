import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import { ApiError } from './http';

const maxSourceBytes = 10 * 1024 * 1024;
const maxInputPixels = 40_000_000;
const maxDimension = 12_000;

const hasDeclaredSignature = (source: Buffer, mime: string) => {
  if (mime === 'image/jpeg') return source.length >= 3 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff;
  if (mime === 'image/png') return source.length >= 8
    && source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return source.length >= 12
    && source.subarray(0, 4).toString('ascii') === 'RIFF'
    && source.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

export type ImageProfile = 'cell' | 'cell-history' | 'work-transfer' | 'material';

export type ProcessedImage = {
  master: Buffer;
  thumbnail: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  sha256: string;
  thumbnailSha256: string;
};

const profileSettings: Record<ImageProfile, { masterLongEdge: number; quality: number; targetBytes: number }> = {
  cell: { masterLongEdge: 1600, quality: 82, targetBytes: 500 * 1024 },
  'cell-history': { masterLongEdge: 1280, quality: 78, targetBytes: 250 * 1024 },
  'work-transfer': { masterLongEdge: 1600, quality: 82, targetBytes: 500 * 1024 },
  material: { masterLongEdge: 1280, quality: 78, targetBytes: 200 * 1024 },
};

const encodeWithinTarget = async (pipeline: Sharp, initialQuality: number, targetBytes: number) => {
  let quality = initialQuality;
  let output = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
  while (output.length > targetBytes && quality > 58) {
    quality -= 6;
    output = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  return output;
};

const encodeStrictlyWithinTarget = async (
  source: Buffer,
  longEdges: number[],
  initialQuality: number,
  targetBytes: number,
) => {
  let smallest: Buffer | null = null;
  for (const longEdge of longEdges) {
    const pipeline = sharp(source, { failOn: 'error', limitInputPixels: maxInputPixels })
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true });
    for (let quality = initialQuality; quality >= 42; quality -= 6) {
      const output = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (!smallest || output.length < smallest.length) smallest = output;
      if (output.length <= targetBytes) return output;
    }
  }
  throw new ApiError(
    400,
    `사진을 ${Math.round(targetBytes / 1024)}KB 이하로 최적화하지 못했습니다. 다른 사진을 선택해 주세요.`,
    'PHOTO_COMPRESSION_FAILED',
  );
};

export const processUploadedImage = async (
  source: Buffer,
  declaredMime: string,
  profile: ImageProfile,
): Promise<ProcessedImage> => {
  const mime = declaredMime.toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') {
    throw new ApiError(400, 'HEIC 사진은 아직 지원하지 않습니다. JPG로 변환 후 다시 등록해 주세요.', 'HEIC_NOT_SUPPORTED');
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  }
  if (!source.length || source.length > maxSourceBytes) {
    throw new ApiError(400, '사진 크기는 10MB 이하여야 합니다.', 'INVALID_PHOTO_SIZE');
  }
  if (!hasDeclaredSignature(source, mime)) {
    throw new ApiError(400, '사진의 실제 파일 형식과 MIME 형식이 일치하지 않습니다.', 'INVALID_PHOTO_SIGNATURE');
  }

  try {
    const decoder = sharp(source, { failOn: 'error', limitInputPixels: maxInputPixels });
    const metadata = await decoder.metadata();
    const actualMime = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png'
      ? 'image/png' : metadata.format === 'webp' ? 'image/webp' : '';
    if (!actualMime || actualMime !== mime) {
      throw new ApiError(400, '사진의 실제 파일 형식과 MIME 형식이 일치하지 않습니다.', 'INVALID_PHOTO_SIGNATURE');
    }
    if (!metadata.width || !metadata.height || metadata.width > maxDimension || metadata.height > maxDimension) {
      throw new ApiError(400, '사진 해상도가 허용 범위를 초과했습니다.', 'INVALID_PHOTO_DIMENSIONS');
    }

    // rotate() honors EXIF orientation. JPEG output without withMetadata() strips EXIF/GPS.
    const settings = profileSettings[profile];
    const oriented = sharp(source, { failOn: 'error', limitInputPixels: maxInputPixels }).rotate();
    const masterPipeline = oriented.clone().resize({
      width: settings.masterLongEdge,
      height: settings.masterLongEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const master = profile === 'cell-history'
      ? await encodeStrictlyWithinTarget(source, [1280, 1152, 1024, 896, 768], settings.quality, settings.targetBytes)
      : await encodeWithinTarget(masterPipeline, settings.quality, settings.targetBytes);
    const thumbnail = profile === 'cell-history'
      ? await encodeStrictlyWithinTarget(source, [480, 420, 360, 320], 72, 30 * 1024)
      : await encodeWithinTarget(
        oriented.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }),
        72,
        40 * 1024,
      );
    const masterMetadata = await sharp(master).metadata();
    const thumbnailMetadata = await sharp(thumbnail).metadata();
    if (!masterMetadata.width || !masterMetadata.height || !thumbnailMetadata.width || !thumbnailMetadata.height) {
      throw new Error('encoded image dimensions are missing');
    }
    return {
      master,
      thumbnail,
      mimeType: 'image/jpeg',
      width: masterMetadata.width,
      height: masterMetadata.height,
      thumbnailWidth: thumbnailMetadata.width,
      thumbnailHeight: thumbnailMetadata.height,
      sha256: createHash('sha256').update(master).digest('hex'),
      thumbnailSha256: createHash('sha256').update(thumbnail).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, '손상되었거나 지원하지 않는 사진입니다.', 'INVALID_PHOTO');
  }
};

export const decodePhotoDataUrl = (dataUrl: string) => {
  const heic = /^data:image\/(?:heic|heif);base64,/i.test(dataUrl);
  if (heic) throw new ApiError(400, 'HEIC 사진은 아직 지원하지 않습니다. JPG로 변환 후 다시 등록해 주세요.', 'HEIC_NOT_SUPPORTED');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
};
