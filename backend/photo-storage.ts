import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './http';
import { env } from './env';

const root = path.join(env.privateStoragePath, 'private-photos');
const maxPhotoBytes = 10 * 1024 * 1024;
const extensionByMime = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp']]);

const hasValidSignature = (buffer: Buffer, mime: string) => {
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

export const savePrivatePhoto = (dataUrl: string) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new ApiError(400, 'JPG, PNG, WEBP 사진만 업로드할 수 있습니다.', 'INVALID_PHOTO_TYPE');
  const mimeType = match[1].toLowerCase();
  const extension = extensionByMime.get(mimeType);
  const buffer = Buffer.from(match[2], 'base64');
  if (!extension || !buffer.length || buffer.length > maxPhotoBytes) {
    throw new ApiError(400, '사진 크기는 10MB 이하여야 합니다.', 'INVALID_PHOTO_SIZE');
  }
  if (!hasValidSignature(buffer, mimeType)) {
    throw new ApiError(400, '사진의 실제 파일 형식이 MIME 형식과 일치하지 않습니다.', 'INVALID_PHOTO_SIGNATURE');
  }
  const date = new Date();
  const objectKey = `photos/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extension}`;
  const absolutePath = resolvePrivatePhoto(objectKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer, { flag: 'wx', mode: 0o600 });
  return { objectKey, mimeType, size: buffer.length };
};

export const resolvePrivatePhoto = (objectKey: string) => {
  if (!/^photos\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(objectKey)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, objectKey.replace(/^photos\//, ''));
  if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
    throw new ApiError(400, '사진 저장 경로가 올바르지 않습니다.', 'INVALID_PHOTO_PATH');
  }
  return absolutePath;
};

export const removePrivatePhoto = (objectKey: string) => {
  if (!objectKey.startsWith('photos/')) return;
  const absolutePath = resolvePrivatePhoto(objectKey);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

export const privatePhotoMime = (objectKey: string) => objectKey.endsWith('.png')
  ? 'image/png'
  : objectKey.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
