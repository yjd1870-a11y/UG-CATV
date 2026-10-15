import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// An opt-in, isolated browser-test environment. Never imports production .env files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.tmp', 'manual-preview');
fs.mkdirSync(runtime, { recursive: true });
process.env.NODE_ENV = 'development'; process.env.PORT = '3002'; process.env.STORAGE_DRIVER = 'local';
process.env.DATABASE_PATH = path.join(runtime, 'catv.sqlite'); process.env.PRIVATE_STORAGE_PATH = path.join(runtime, 'storage');
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3002,http://127.0.0.1:3002'; process.env.ENFORCE_HTTPS = 'false';
process.env.SESSION_COOKIE_NAME = 'catv_manual_preview'; process.env.VITE_API_BASE_URL = '/api';
process.env.SESSION_COOKIE_SAME_SITE = 'strict';
process.env.DISABLE_HMR = 'true';
await import('../backend/server');
const { db } = await import('../backend/db');
const { saveManualModel, saveManualText, reserveManualUpload } = await import('../backend/manual-service');
const existing = db.prepare("SELECT id FROM manual_models WHERE name = '테스트 OTDR 모델' AND deleted_at IS NULL").get() as { id: string } | undefined;
if (!existing) {
  const model = saveManualModel(null, { categoryId: 'otdr', name: '테스트 OTDR 모델', manufacturer: '검증용 제조사', description: '브라우저 테스트 전용 자료' });
  saveManualModel(null, { categoryId: 'otdr', name: '다른 OTDR 모델', manufacturer: '검증용 제조사' });
  saveManualModel(null, { categoryId: 'rf-meter', name: '테스트 RF 모델' });
  saveManualText(model.id, { body: '장비 화면의 측정 항목과 연결 위치를 확인하세요.\n아래 동영상과 사진은 화면 동작 검증을 위한 테스트 자료입니다.', tips: '현장에서 자주 확인하는 내용을 기록할 수 있습니다.', version: 1 });
  const base = 'http://127.0.0.1:3002/api';
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user-5', password: '1234' }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  const upload = async (kind: string, body: Buffer, mime: string, fileName: string, title: string, posterId: string | null = null) => {
    const intent = reserveManualUpload(model.id, { kind, bytes: body.length, mime, fileName, title, posterId }, 'user-5');
    const response = await fetch(`http://127.0.0.1:3002${intent.uploadUrl}`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': mime }, body: body as unknown as BodyInit });
    if (!response.ok) throw new Error(await response.text()); return intent.id;
  };
  const jpg = await sharp(Buffer.from('<svg width="640" height="360"><rect width="640" height="360" fill="#eefafa"/><rect x="155" y="35" width="330" height="290" rx="24" fill="#173b57"/><rect x="185" y="65" width="270" height="190" fill="#0d9488"/><text x="320" y="155" font-size="32" text-anchor="middle" fill="white">TEST OTDR</text><circle cx="220" cy="290" r="10" fill="white"/><circle cx="270" cy="290" r="10" fill="white"/></svg>')).jpeg().toBuffer();
  await upload('photo', jpg, 'image/jpeg', 'test-otdr.jpg', '장비 전면 (테스트)');
  const poster = await upload('thumbnail', jpg, 'image/jpeg', 'test-video-thumbnail.jpg', '동영상 썸네일');
  await upload('photo', jpg, 'image/jpeg', 'test-connection.jpg', '연결 위치 (테스트)');
  const mp4 = fs.readFileSync(path.join(root, 'backend/tests/fixtures/manual-playback.mp4'));
  for (const title of ['기본 조작', '측정 화면', '결과 확인', '현장 참고']) await upload('video', mp4, 'video/mp4', 'test-guide.mp4', title, poster);
  const parts = ['%PDF-1.4\n']; const offsets = [0];
  const objects = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const stream = 'BT /F1 16 Tf 30 120 Td (Manual test PDF) Tj ET'; objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${i + 1} 0 obj\n${object}\nendobj\n`); });
  const xref = Buffer.byteLength(parts.join('')); parts.push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
  await upload('pdf', Buffer.from(parts.join('')), 'application/pdf', 'test-manual.pdf', '모델 설명서 (테스트)');
}
console.log('[MANUAL PREVIEW] Isolated test site: http://localhost:3002/manual');
