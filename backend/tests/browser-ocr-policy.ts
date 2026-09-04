import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const engine = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/engine.ts'), 'utf8');
const quality = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/quality.ts'), 'utf8');
const validation = fs.readFileSync(path.join(root, 'src/features/transfers/browser-ocr/validation.ts'), 'utf8');
const list = fs.readFileSync(path.join(root, 'src/components/transfer/TransferList.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/components/transfer/TransferDetail.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/routes/work-transfers.ts'), 'utf8');
const securityMiddleware = fs.readFileSync(path.join(root, 'backend/security/middleware.ts'), 'utf8');
const pagesHeaders = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');

assert.match(engine, /workerPath: '\/ocr\/tesseract\/worker\.min\.js'/);
assert.match(engine, /cachePath: OCR_MODEL_CACHE_PATH/);
assert.match(engine, /catv-work-transfer-ocr-v12-20260903/);
assert.match(engine, /WebAssembly\.compile/);
assert.match(engine, /prepareOcrAddressCanvas/);
assert.match(engine, /activeRecognitionCancel\?\.\(\)/);
assert.doesNotMatch(engine, /recognitionInProgress|다른 OCR 작업이 진행 중입니다/);
assert.match(engine, /for \(const index of \[1, 2\] as const\)/);
assert.doesNotMatch(engine, /점검요청일을 인식|\[날짜 영역 재검사\]|regions\.date/);
assert.doesNotMatch(engine, /blocks:\s*true/);
assert.match(engine, /PSM\.SINGLE_LINE/);
assert.match(engine, /langPath: '\/ocr\/lang-v9'/);
assert.match(engine, /createWorker\('kor\+eng'/);
assert.match(quality, /moireReduction/);
assert.match(quality, /prepareOcrAddressCanvas[\s\S]*contrast: 1\.2/);
assert.match(quality, /prepareOcrBranchDetailCanvas/);
assert.match(quality, /detectRequestHeaderBottomRatio/);
assert.match(engine, /headerBottom > 0\.13/);
assert.match(engine, /bitmap\.width > bitmap\.height/);
assert.match(validation, /branchFromCustomerAddress/);
assert.doesNotMatch(validation, /inspectionDateField|normalizeDateDigits/);
assert.match(quality, /orientedBitmapForFile/);
assert.match(quality, /jpegExifOrientation/);
assert.match(quality, /imageOrientation: 'none'/);
assert.match(quality, /context\.setTransform/);
assert.doesNotMatch(quality, /ocrdebug|ocrCropPreview|ocrOrientationPreview/);
assert.doesNotMatch(engine, /https?:\/\//);
assert.doesNotMatch(engine, /ocrCropDebug|diagnostic|document\.body\.append/);
assert.doesNotMatch(list, /\bocrPreview\b|imageDataUrl.*ocr/i);
assert.match(list, /requestPhotos: evidencePhotos/);
assert.match(list, /OCR 사진 갤러리에서 선택/);
assert.match(list, /await processEvidencePhotos\(\[normalizedFile\], true\)/);
assert.match(list, /readOnly value=\{FIXED_INSPECTION_COMPANY\}/);
assert.doesNotMatch(list, /result\.fields\.inspectionRequestedDate/);
assert.match(list, /resolveInspectionRequestedDate\(inspectionRequestedDate, inspectionDateEdited\.current\)/);
assert.doesNotMatch(list, />매체구분 \*</);
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
  'public/ocr/lang-v9/kor.traineddata.gz',
  'public/ocr/lang-v9/eng.traineddata.gz',
]) assert.ok(fs.statSync(path.join(root, relative)).size > 100_000, `${relative} asset is missing or truncated`);

console.log('Browser OCR policy test passed: same-origin assets, latest-request OCR, focused moire retries, gallery-only input');
