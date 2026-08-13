import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './http';
import { env } from './env';
import {
  deleteR2Object,
  putR2Object,
  r2SignedUrlExpiresAt,
  signedR2DownloadUrl,
  signedR2UploadUrl,
  usesR2Storage,
} from './object-storage';

const root = path.join(env.privateStoragePath, 'private-photos');
const maxPhotoBytes = 10 * 1024 * 1024;
const extensionByMime = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const photoKeyPattern = /^photos\/[0-9]{4}\/[0-9]{2}\/(?:[a-z0-9_-]+\/)?[0-9a-f-]+\.(?:jpg|png|webp)$/i;

const hasValidSignature = (buffer: Buffer, mime: string) => {
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

export const validatePhotoUpload = (mimeType: string, size: number) => {
  const normalizedMime = mimeType.toLowerCase();
  const extension = extensionByMime.get(normalizedMime);
  if (!extension) throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxPhotoBytes) {
    throw new ApiError(400, '사진 크기는 10MB 이하여야 합니다.', 'INVALID_PHOTO_SIZE');
  }
  return { mimeType: normalizedMime, extension };
};

export const createPhotoObjectKey = (mimeType: string, uploadedBy = '') => {
  const { extension } = validatePhotoUpload(mimeType, 1);
  const date = new Date();
  const safeUploader = uploadedBy.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  const uploaderPrefix = safeUploader ? `${safeUploader}/` : '';
  return `photos/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${uploaderPrefix}${randomUUID()}${extension}`;
};

export const savePrivatePhoto = async (dataUrl: string, uploadedBy = '') => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  validatePhotoUpload(mimeType, buffer.length);
  if (!hasValidSignature(buffer, mimeType)) {
    throw new ApiError(400, '사진의 실제 파일 형식과 MIME 형식이 일치하지 않습니다.', 'INVALID_PHOTO_SIGNATURE');
  }
  const objectKey = createPhotoObjectKey(mimeType, uploadedBy);
  if (usesR2Storage) {
    await putR2Object(objectKey, buffer, mimeType);
  } else {
    const absolutePath = resolvePrivatePhoto(objectKey);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer, { flag: 'wx', mode: 0o600 });
  }
  return { objectKey, mimeType, size: buffer.length };
};

export const resolvePrivatePhoto = (objectKey: string) => {
  if (!photoKeyPattern.test(objectKey)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, objectKey.replace(/^photos\//, ''));
  if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  return absolutePath;
};

export const removePrivatePhoto = async (objectKey: string) => {
  if (!photoKeyPattern.test(objectKey)) return;
  if (usesR2Storage) {
    await deleteR2Object(objectKey);
    return;
  }
  const absolutePath = resolvePrivatePhoto(objectKey);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

export const privatePhotoDownloadUrl = (objectKey: string) => {
  if (!photoKeyPattern.test(objectKey)) throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  return signedR2DownloadUrl(objectKey);
};

export const privatePhotoUploadUrl = async (objectKey: string, mimeType: string, size: number) => {
  if (!usesR2Storage || !photoKeyPattern.test(objectKey)) {
    throw new ApiError(400, '직접 업로드를 사용할 수 없습니다.', 'DIRECT_UPLOAD_UNAVAILABLE');
  }
  validatePhotoUpload(mimeType, size);
  return {
    uploadUrl: await signedR2UploadUrl(objectKey, mimeType, size),
    expiresAt: r2SignedUrlExpiresAt(),
  };
};

export const privatePhotoMime = (objectKey: string) => objectKey.endsWith('.png')
  ? 'image/png'
  : objectKey.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
