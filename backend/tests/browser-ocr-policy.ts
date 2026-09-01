import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const engine = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/engine.ts'), 'utf8');
const quality = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/quality.ts'), 'utf8');
const list = fs.readFileSync(path.join(root, 'src/components/transfer/TransferList.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/components/transfer/TransferDetail.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
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
assert.match(quality, /bitmap\.height \* 0\.32/);
assert.match(quality, /2600 \/ Math\.max\(sourceWidth, sourceHeight\)/);
assert.doesNotMatch(engine, /https?:\/\//);
assert.doesNotMatch(list, /\bocrPreview\b|imageDataUrl.*ocr/i);
assert.match(list, /requestPhotos: evidencePhotos/);
assert.match(list, /OCR 사진 갤러리에서 선택/);
assert.match(list, /await processEvidencePhotos\(\[normalizedFile\], true\)/);
assert.doesNotMatch(list, /capture="environment"|OCR 사진 촬영|카메라로 촬영/);
assert.match(list, /accept="image\/jpeg,image\/png,image\/webp" multiple onChange=\{\(event\) => void handleOcrPhoto/);
assert.match(detail, /accept="image\/jpeg,image\/png,image\/webp" multiple/);
assert.match(app, /app-main-content/);
assert.match(styles, /padding-bottom: calc\(6\.25rem \+ env\(safe-area-inset-bottom\)\) !important/);
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

console.log('Browser OCR policy test passed: same-origin assets, gallery-only input, OCR photo auto-attachment');
