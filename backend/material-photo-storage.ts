import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './env';
import { ApiError } from './http';
import { deleteR2Object, putR2Object, readR2Object, usesR2Storage } from './object-storage';
import type { SavedPhotoInput } from './inventory-service';
import { decodePhotoDataUrl, processUploadedImage } from './image-processing';

const root = path.join(env.privateStoragePath, 'private-material-photos');
const keyPattern = /^material-photos\/(?:master|thumbnails)\/[0-9]{4}-[0-9]{2}\/[a-z0-9-]+\/(?:before|after)-[a-f0-9-]+\.jpg$/i;

const localPath = (key: string) => {
  if (!keyPattern.test(key)) throw new ApiError(400, '자재사진 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, key.replace(/^material-photos\//, ''));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new ApiError(400, '자재사진 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  return resolved;
};

export const saveMaterialPhoto = async (
  dataUrl: unknown,
  transactionId: string,
  slot: 'BEFORE' | 'AFTER',
): Promise<SavedPhotoInput> => {
  if (typeof dataUrl !== 'string') throw new ApiError(400, '사진 데이터가 필요합니다.', 'PHOTO_REQUIRED');
  const decoded = decodePhotoDataUrl(dataUrl);
  const processed = await processUploadedImage(decoded.buffer, decoded.mimeType, 'material');
  const month = new Date().toISOString().slice(0, 7);
  const slotName = slot === 'BEFORE' ? 'before' : 'after';
  const suffix = `${month}/${transactionId}/${slotName}-${randomUUID()}.jpg`;
  const objectKey = `material-photos/master/${suffix}`;
  const thumbnailObjectKey = `material-photos/thumbnails/${suffix}`;
  try {
    if (usesR2Storage) {
      await putR2Object(objectKey, processed.master, 'image/jpeg', { sha256: processed.sha256, transaction: transactionId, slot: slotName }, 'private, no-store, max-age=0');
      await putR2Object(thumbnailObjectKey, processed.thumbnail, 'image/jpeg', { sha256: processed.thumbnailSha256, transaction: transactionId, slot: slotName }, 'private, no-store, max-age=0');
    } else {
      const target = localPath(objectKey);
      const thumbTarget = localPath(thumbnailObjectKey);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.mkdirSync(path.dirname(thumbTarget), { recursive: true });
      fs.writeFileSync(target, processed.master, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(thumbTarget, processed.thumbnail, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    await removeMaterialPhoto(objectKey).catch(() => undefined);
    await removeMaterialPhoto(thumbnailObjectKey).catch(() => undefined);
    throw error;
  }
  return {
    id: randomUUID(), slot, objectKey, thumbnailObjectKey, mimeType: 'image/jpeg',
    size: processed.master.length, thumbnailSize: processed.thumbnail.length,
    width: processed.width, height: processed.height,
    thumbnailWidth: processed.thumbnailWidth, thumbnailHeight: processed.thumbnailHeight,
    sha256: processed.sha256,
    thumbnailSha256: processed.thumbnailSha256,
  };
};

export const removeMaterialPhoto = async (objectKey: string) => {
  if (usesR2Storage) await deleteR2Object(objectKey);
  else fs.rmSync(localPath(objectKey), { force: true });
};

export const readMaterialPhoto = async (objectKey: string) => {
  if (usesR2Storage) return (await readR2Object(objectKey)).body;
  return fs.readFileSync(localPath(objectKey));
};
