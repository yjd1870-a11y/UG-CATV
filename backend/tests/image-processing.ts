import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ApiError } from '../http';
import { decodePhotoDataUrl, processUploadedImage } from '../image-processing';

const expectApiError = async (run: () => Promise<unknown> | unknown, code: string) => {
  try {
    await run();
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
  }
};

const orientedSource = await sharp({
  create: { width: 1200, height: 600, channels: 3, background: { r: 30, g: 120, b: 210 } },
}).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
const oriented = await processUploadedImage(orientedSource, 'image/jpeg', 'cell');
assert.equal(oriented.width, 600);
assert.equal(oriented.height, 1200);
const orientedMetadata = await sharp(oriented.master).metadata();
assert.equal(orientedMetadata.orientation, undefined);
assert.equal(orientedMetadata.exif, undefined);
assert.equal(orientedMetadata.icc, undefined);

const largeSource = await sharp({
  create: { width: 2400, height: 1800, channels: 3, background: { r: 170, g: 120, b: 80 } },
}).png().toBuffer();
const cell = await processUploadedImage(largeSource, 'image/png', 'cell');
const cellHistory = await processUploadedImage(largeSource, 'image/png', 'cell-history');
const material = await processUploadedImage(largeSource, 'image/png', 'material');
assert.equal(Math.max(cell.width, cell.height), 1600);
assert.equal(Math.max(material.width, material.height), 1280);
assert.ok(Math.max(cellHistory.width, cellHistory.height) <= 1280);
assert.ok(Math.max(cell.thumbnailWidth, cell.thumbnailHeight) <= 480);
assert.ok(cell.master.length <= 500 * 1024);
assert.ok(material.master.length <= 200 * 1024);
assert.ok(cellHistory.master.length <= 250 * 1024);
assert.ok(cellHistory.thumbnail.length <= 30 * 1024);
assert.ok(cell.thumbnail.length <= 40 * 1024);
assert.equal(createHash('sha256').update(cell.master).digest('hex'), cell.sha256);
assert.equal(createHash('sha256').update(cell.thumbnail).digest('hex'), cell.thumbnailSha256);
assert.notEqual(cell.sha256, cell.thumbnailSha256);

const smallSource = await sharp({
  create: { width: 80, height: 40, channels: 3, background: { r: 20, g: 40, b: 60 } },
}).webp().toBuffer();
const small = await processUploadedImage(smallSource, 'image/webp', 'cell');
assert.equal(small.width, 80);
assert.equal(small.height, 40);
assert.ok(small.master.length < 300 * 1024, 'small images must not be padded to a target size');

await expectApiError(() => processUploadedImage(Buffer.from('not-an-image'), 'image/png', 'cell'), 'INVALID_PHOTO_SIGNATURE');
await expectApiError(() => processUploadedImage(largeSource, 'image/jpeg', 'cell'), 'INVALID_PHOTO_SIGNATURE');
await expectApiError(() => decodePhotoDataUrl('data:image/heic;base64,AAAA'), 'HEIC_NOT_SUPPORTED');

const tooWide = await sharp({
  create: { width: 12_001, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
}).png().toBuffer();
await expectApiError(() => processUploadedImage(tooWide, 'image/png', 'cell'), 'INVALID_PHOTO_DIMENSIONS');

const pixelBomb = await sharp({
  create: { width: 6500, height: 6500, channels: 3, background: { r: 0, g: 0, b: 0 } },
}).png({ compressionLevel: 9 }).toBuffer();
await expectApiError(() => processUploadedImage(pixelBomb, 'image/png', 'cell'), 'INVALID_PHOTO');

console.log('Image processing test passed: orientation, metadata stripping, dimensions, MIME/decode checks, hashes, targets, HEIC, and pixel limits');
