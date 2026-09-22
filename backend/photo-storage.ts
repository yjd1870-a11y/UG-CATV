import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './http';
import { env } from './env';
import { decodePhotoDataUrl, processUploadedImage, type ImageProfile } from './image-processing';
import {
  deleteR2Object,
  putR2Object,
  r2SignedUrlExpiresAt,
  readR2Object,
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
const legacyPattern = /^photos\/[0-9]{4}\/[0-9]{2}\/(?:[a-z0-9_-]+\/)?[0-9a-f-]+\.(?:jpg|png|webp)$/i;
const managedPattern = /^(?:cell-photos|cell-history-photos|work-transfer-photos)\/(?:master|thumbnails)\/[0-9]{4}\/[0-9]{2}\/[a-z0-9_-]+\/[0-9a-f-]+\.jpg$/i;
const quarantinePattern = /^photo-quarantine\/cell\/[0-9]{4}\/[0-9]{2}\/[a-z0-9_-]+\/[0-9a-f-]+\.(?:jpg|png|webp)$/i;

const allowedKey = (key: string) => legacyPattern.test(key) || managedPattern.test(key) || quarantinePattern.test(key);
const safeUploader = (value: string) => value.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'unknown';
const monthParts = () => {
  const date = new Date();
  return [String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0')];
};

export const validatePhotoUpload = (mimeType: string, size: number) => {
  const normalizedMime = mimeType.toLowerCase();
  const extension = extensionByMime.get(normalizedMime);
  if (normalizedMime === 'image/heic' || normalizedMime === 'image/heif') {
    throw new ApiError(400, 'HEIC 사진은 아직 지원하지 않습니다. JPG로 변환 후 다시 등록해 주세요.', 'HEIC_NOT_SUPPORTED');
  }
  if (!extension) throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxPhotoBytes) {
    throw new ApiError(400, '사진 크기는 10MB 이하여야 합니다.', 'INVALID_PHOTO_SIZE');
  }
  return { mimeType: normalizedMime, extension };
};

/** CELL direct uploads always land in quarantine and are never served from there. */
export const createPhotoObjectKey = (mimeType: string, uploadedBy = '') => {
  const { extension } = validatePhotoUpload(mimeType, 1);
  const [year, month] = monthParts();
  return `photo-quarantine/cell/${year}/${month}/${safeUploader(uploadedBy)}/${randomUUID()}${extension}`;
};

const localPath = (objectKey: string) => {
  if (!allowedKey(objectKey)) throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  const absoluteRoot = path.resolve(root);
  const relative = legacyPattern.test(objectKey) ? objectKey.replace(/^photos\//, '') : objectKey;
  const absolutePath = path.resolve(absoluteRoot, relative);
  if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  return absolutePath;
};

const putObject = async (key: string, body: Buffer, metadata: Record<string, string>) => {
  if (usesR2Storage) {
    await putR2Object(key, body, 'image/jpeg', metadata, 'private, no-store, max-age=0');
    return;
  }
  const target = localPath(key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { flag: 'wx', mode: 0o600 });
};

const readObject = async (key: string) => usesR2Storage
  ? (await readR2Object(key)).body
  : fs.readFileSync(localPath(key));

const saveProcessed = async (source: Buffer, mimeType: string, uploadedBy: string, profile: ImageProfile) => {
  const processed = await processUploadedImage(source, mimeType, profile);
  const [year, month] = monthParts();
  const basePrefix = profile === 'work-transfer'
    ? 'work-transfer-photos'
    : profile === 'cell-history' ? 'cell-history-photos' : 'cell-photos';
  const id = randomUUID();
  const suffix = `${year}/${month}/${safeUploader(uploadedBy)}/${id}.jpg`;
  const objectKey = `${basePrefix}/master/${suffix}`;
  const thumbnailObjectKey = `${basePrefix}/thumbnails/${suffix}`;
  const metadata = { sha256: processed.sha256, profile };
  try {
    await putObject(objectKey, processed.master, metadata);
    await putObject(thumbnailObjectKey, processed.thumbnail, { sha256: processed.thumbnailSha256, profile });
  } catch (error) {
    await removePrivatePhoto(objectKey).catch(() => undefined);
    await removePrivatePhoto(thumbnailObjectKey).catch(() => undefined);
    throw error;
  }
  return {
    objectKey,
    thumbnailObjectKey,
    mimeType: processed.mimeType,
    size: processed.master.length,
    thumbnailSize: processed.thumbnail.length,
    width: processed.width,
    height: processed.height,
    thumbnailWidth: processed.thumbnailWidth,
    thumbnailHeight: processed.thumbnailHeight,
    sha256: processed.sha256,
    thumbnailSha256: processed.thumbnailSha256,
  };
};

export const savePrivatePhoto = async (
  dataUrl: string,
  uploadedBy = '',
  profile: 'cell' | 'cell-history' | 'work-transfer' = 'cell',
) => {
  const decoded = decodePhotoDataUrl(dataUrl);
  return saveProcessed(decoded.buffer, decoded.mimeType, uploadedBy, profile);
};

export const promoteQuarantinedCellPhoto = async (objectKey: string, mimeType: string, uploadedBy: string) => {
  if (!quarantinePattern.test(objectKey)) throw new ApiError(400, '격리 사진 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  const source = await readObject(objectKey);
  try {
    return await saveProcessed(source, mimeType, uploadedBy, 'cell');
  } finally {
    await removePrivatePhoto(objectKey).catch(() => undefined);
  }
};

export const promoteQuarantinedCellHistoryPhoto = async (objectKey: string, mimeType: string, uploadedBy: string) => {
  if (!quarantinePattern.test(objectKey)) throw new ApiError(400, '격리 사진 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  const source = await readObject(objectKey);
  try {
    return await saveProcessed(source, mimeType, uploadedBy, 'cell-history');
  } finally {
    await removePrivatePhoto(objectKey).catch(() => undefined);
  }
};

export const resolvePrivatePhoto = (objectKey: string) => localPath(objectKey);

export const removePrivatePhoto = async (objectKey: string) => {
  if (!allowedKey(objectKey)) return;
  if (usesR2Storage) {
    await deleteR2Object(objectKey);
    return;
  }
  fs.rmSync(localPath(objectKey), { force: true });
};

export const privatePhotoDownloadUrl = (objectKey: string) => {
  if (!allowedKey(objectKey) || quarantinePattern.test(objectKey)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  return signedR2DownloadUrl(objectKey);
};

export const privatePhotoUploadUrl = async (objectKey: string, mimeType: string, size: number) => {
  if (!usesR2Storage || !quarantinePattern.test(objectKey)) {
    throw new ApiError(400, '직접 업로드를 사용할 수 없습니다.', 'DIRECT_UPLOAD_UNAVAILABLE');
  }
  validatePhotoUpload(mimeType, size);
  return {
    uploadUrl: await signedR2UploadUrl(objectKey, mimeType, size, { quarantine: 'cell-photo' }),
    expiresAt: r2SignedUrlExpiresAt(),
  };
};

export const privatePhotoMime = (objectKey: string) => objectKey.endsWith('.png')
  ? 'image/png'
  : objectKey.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
