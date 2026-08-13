import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export const floorPlanStorageRoot = path.join(env.privateStoragePath, 'floor-plans');

const extensionForMime = (mime: string) => ({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}[mime] || '');

export const saveFloorPlanDataUrl = (id: string, dataUrl: string) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('평면도 이미지 데이터 형식이 올바르지 않습니다.');
  const extension = extensionForMime(match[1].toLowerCase());
  if (!extension) throw new Error('지원하지 않는 평면도 이미지 형식입니다.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('평면도 이미지 크기는 20MB 이하여야 합니다.');
  const mime = match[1].toLowerCase();
  const validSignature = mime === 'image/png'
    ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mime === 'image/jpeg'
      ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!validSignature) throw new Error('평면도 이미지의 실제 파일 형식이 MIME 형식과 일치하지 않습니다.');
  fs.mkdirSync(floorPlanStorageRoot, { recursive: true });
  const objectKey = `floorplans/${id}${extension}`;
  const absolutePath = resolveFloorPlanObject(objectKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);
  return { objectKey, mimeType: match[1].toLowerCase(), size: buffer.length };
};

export const resolveFloorPlanObject = (objectKey: string) => {
  const root = path.resolve(floorPlanStorageRoot);
  const absolutePath = path.resolve(root, objectKey.replace(/^floorplans[\\/]/, ''));
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error('유효하지 않은 평면도 객체 키입니다.');
  }
  return absolutePath;
};

export const removeFloorPlanObject = (objectKey: string | null | undefined) => {
  if (!objectKey) return;
  const absolutePath = resolveFloorPlanObject(objectKey);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

export const imageMimeType = (fileName: string) => {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
};
