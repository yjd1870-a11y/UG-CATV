export const MANUAL_PHOTO_INPUT_BYTES = 10 * 1024 * 1024;
export const MANUAL_PHOTO_MAX_PIXELS = 40_000_000;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export class PhotoCompressionError extends Error {
  constructor(message: string, public readonly allowOriginal = false) { super(message); }
}
export interface CompressedPhoto { original: File; file: File; width: number; height: number }

// Inspect dimensions before decoding, so a tiny compressed file cannot allocate an
// arbitrarily large bitmap. JPEG metadata beyond this bounded header is rejected.
export async function inspectManualPhoto(file: File) {
  if (!imageTypes.includes(file.type) || !file.size || file.size > MANUAL_PHOTO_INPUT_BYTES) throw new PhotoCompressionError('JPG·PNG·WebP, 원본 최대 10MB를 선택해주세요.');
  const bytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer); const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  let width = 0; let height = 0;
  if (file.type === 'image/png' && bytes.length >= 33 && ascii(1, 3) === 'PNG' && view.getUint32(0) === 0x89504e47 && ascii(12, 4) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break; }
      offset += length;
    }
  } else if (file.type === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const type = ascii(12, 4);
    if (type === 'VP8X') {
      if (bytes[20] & 2) throw new PhotoCompressionError('움직이는 사진은 지원하지 않습니다. 정지 사진을 선택해주세요.');
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (type === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
  }
  if (!width || !height || width * height > MANUAL_PHOTO_MAX_PIXELS || Math.max(width, height) > 16384) throw new PhotoCompressionError('사진 크기를 확인해주세요. 최대 4천만 화소, 한 변 16384px까지 지원합니다.');
  return { width, height };
}

const encode = (canvas: HTMLCanvasElement, mime: string) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('이미지 변환 실패')), mime, 0.85);
});

async function compress(file: File, maxSide: number): Promise<CompressedPhoto> {
  await inspectManualPhoto(file);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new PhotoCompressionError('사진을 읽을 수 없습니다. 손상 여부와 형식을 확인해주세요.'); }
  const canvas = document.createElement('canvas');
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MANUAL_PHOTO_MAX_PIXELS || Math.max(bitmap.width, bitmap.height) > 16384) throw new Error('사진 크기 초과');
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 사용 불가');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let transparent = false;
    // Inspect strips instead of allocating another full-size RGBA image.
    for (let y = 0; y < canvas.height && !transparent; y += 64) {
      const pixels = context.getImageData(0, y, canvas.width, Math.min(64, canvas.height - y)).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { transparent = true; break; }
    }
    let blob = await encode(canvas, 'image/webp');
    if (blob.type !== 'image/webp') blob = await encode(canvas, transparent ? 'image/png' : 'image/jpeg');
    if (!imageTypes.includes(blob.type)) throw new Error('지원하지 않는 출력 형식');
    if (blob.size >= file.size) return { original: file, file, width: bitmap.width, height: bitmap.height };
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${extension}`;
    return { original: file, file: new File([blob], name, { type: blob.type, lastModified: file.lastModified }), width: canvas.width, height: canvas.height };
  } catch { throw new PhotoCompressionError('사진 압축에 실패했습니다. 다시 선택하거나 원본을 업로드해주세요.', true); }
  finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}

// Two photo inputs can exist in the editor. Serialize decoding across both.
let queue: Promise<unknown> = Promise.resolve();
export function compressManualPhoto(file: File, maxSide: number, signal?: AbortSignal): Promise<CompressedPhoto> {
  const job = queue.catch(() => {}).then(() => { signal?.throwIfAborted(); return compress(file, maxSide); });
  queue = job.catch(() => {}); return job;
}
