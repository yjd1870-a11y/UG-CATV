import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './env';
import { deleteR2Object, putR2Object, readR2Object, usesR2Storage } from './object-storage';

export const floorPlanStorageRoot = path.join(env.privateStoragePath, 'floor-plans');

const extensionForMime = (mime: string) => ({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}[mime] || '');

const validSignature = (buffer: Buffer, mime: string) => mime === 'image/png'
  ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  : mime === 'image/jpeg'
    ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';

export const saveFloorPlanDataUrl = async (id: string, dataUrl: string) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('평면도 이미지 데이터 형식이 올바르지 않습니다.');
  const mimeType = match[1].toLowerCase();
  const extension = extensionForMime(mimeType);
  if (!extension) throw new Error('지원하지 않는 평면도 이미지 형식입니다.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('평면도 이미지 크기는 20MB 이하여야 합니다.');
  if (!validSignature(buffer, mimeType)) throw new Error('평면도 이미지의 실제 파일 형식과 MIME 형식이 일치하지 않습니다.');
  const safeId = id.replace(/[^a-z0-9_-]/gi, '').slice(0, 100);
  const objectKey = `floorplans/${safeId}/${randomUUID()}${extension}`;
  if (usesR2Storage) {
    await putR2Object(objectKey, buffer, mimeType);
  } else {
    const absolutePath = resolveFloorPlanObject(objectKey);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);
  }
  return { objectKey, mimeType, size: buffer.length };
};

export const resolveFloorPlanObject = (objectKey: string) => {
  if (!/^floorplans\/[a-z0-9_-]+\/(?:[a-z0-9-]+\.(?:png|jpg|webp))$/i.test(objectKey)
    && !/^floorplans\/[a-z0-9_-]+\.(?:png|jpg|webp)$/i.test(objectKey)) {
    throw new Error('유효하지 않은 평면도 객체 키입니다.');
  }
  const root = path.resolve(floorPlanStorageRoot);
  const absolutePath = path.resolve(root, objectKey.replace(/^floorplans[\\/]/, ''));
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) throw new Error('유효하지 않은 평면도 객체 키입니다.');
  return absolutePath;
};

export const removeFloorPlanObject = async (objectKey: string | null | undefined) => {
  if (!objectKey) return;
  if (usesR2Storage) {
    await deleteR2Object(objectKey);
    return;
  }
  const absolutePath = resolveFloorPlanObject(objectKey);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

export const readFloorPlanObject = (objectKey: string) => {
  resolveFloorPlanObject(objectKey);
  return readR2Object(objectKey);
};

export const imageMimeType = (fileName: string) => {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
};
