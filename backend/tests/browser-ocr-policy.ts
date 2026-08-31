import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const engine = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/engine.ts'), 'utf8');
const list = fs.readFileSync(path.join(root, 'src/components/transfer/TransferList.tsx'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/routes/work-transfers.ts'), 'utf8');
const securityMiddleware = fs.readFileSync(path.join(root, 'backend/security/middleware.ts'), 'utf8');
const pagesHeaders = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');

assert.match(engine, /workerPath: '\/ocr\/tesseract\/worker\.min\.js'/);
assert.match(engine, /cachePath: OCR_MODEL_CACHE_PATH/);
assert.match(engine, /catv-work-transfer-ocr-v7-20260831/);
assert.match(engine, /WebAssembly\.compile/);
assert.match(engine, /const addressNeedsRetry = fields\.customerAddress\.validationStatus !== 'valid'/);
assert.match(engine, /langPath: '\/ocr\/lang'/);
assert.match(engine, /createWorker\('kor\+eng'/);
assert.doesNotMatch(engine, /https?:\/\//);
assert.doesNotMatch(list, /\bocrPreview\b|imageDataUrl.*ocr/i);
assert.match(list, /requestPhotos: evidencePhotos/);
assert.match(list, /OCR 갤러리 선택/);
assert.match(list, /const files: File\[\] = event\.currentTarget\.files \? Array\.from\(event\.currentTarget\.files\) : \[\]/);
assert.match(routes, /BROWSER_OCR_ONLY/g);
assert.match(securityMiddleware, /script-src 'self'.*'wasm-unsafe-eval'/);
assert.match(pagesHeaders, /script-src 'self' 'wasm-unsafe-eval'/);
assert.doesNotMatch(securityMiddleware, /script-src[^\n]*'unsafe-eval'/);

for (const relative of [
  'public/ocr/tesseract/worker.min.js',
  'public/ocr/tesseract-core/tesseract-core-lstm.wasm.js',
  'public/ocr/lang/kor.traineddata.gz',
  'public/ocr/lang/eng.traineddata.gz',
]) assert.ok(fs.statSync(path.join(root, relative)).size > 100_000, `${relative} asset is missing or truncated`);

console.log('Browser OCR policy test passed: same-origin assets, no preview upload API, evidence photos separated');
