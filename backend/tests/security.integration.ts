import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { env } from '../env';

await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start.');
const base = `http://127.0.0.1:${address.port}/api`;

type Envelope<T> = { success: boolean; data?: T; code?: string; message?: string };
const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() as Envelope<T> : undefined;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
};

const failedUsername = `blocked_${Date.now()}`;
const auditStart = (db.prepare('SELECT CURRENT_TIMESTAMP AS value').get() as { value: string }).value;
let photoId = '';
let cellId = '';

try {
  const health = await call('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const allowedCors = await call('/health', { origin: 'http://localhost:3000' });
  assert.equal(allowedCors.response.headers.get('access-control-allow-origin'), 'http://localhost:3000');

  const anonymousAdmin = await call('/admin/db/status');
  assert.equal(anonymousAdmin.response.status, 401);

  const invalidSession = await call('/admin/db/status', { cookie: 'catv_session=invalid-session-token' });
  assert.equal(invalidSession.response.status, 401);

  const expiredToken = `expired-${randomUUID()}`;
  const expiredHash = createHmac('sha256', env.sessionSecret).update(expiredToken).digest('hex');
  db.prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, 'user-1', ?, datetime('now', '-1 minute'))`)
    .run(randomUUID(), expiredHash);
  const expiredSession = await call('/auth/me', { cookie: `${env.cookieName}=${expiredToken}` });
  assert.equal(expiredSession.response.status, 401);
  assert.equal(expiredSession.payload?.code, 'SESSION_EXPIRED');

  const workerLogin = await call('/auth/login', { method: 'POST', body: { username: 'user-1', password: '1234' } });
  assert.equal(workerLogin.response.status, 200);
  assert.ok(workerLogin.cookie);

  const forbiddenAdmin = await call('/admin/db/status', { cookie: workerLogin.cookie });
  assert.equal(forbiddenAdmin.response.status, 403);

  const forbiddenManagerDailyWorkExport = await call('/daily-work/export', { cookie: workerLogin.cookie });
  assert.equal(forbiddenManagerDailyWorkExport.response.status, 403);
  assert.equal(forbiddenManagerDailyWorkExport.payload?.code, 'FORBIDDEN');

  const injection = await call<{ items: unknown[] }>(`/cells/search?q=${encodeURIComponent("' OR 1=1")}`, { cookie: workerLogin.cookie });
  assert.equal(injection.response.status, 200);
  assert.equal(injection.payload?.data?.items.length, 0);

  const cells = await call<{ items: Array<{ id: string }> }>('/cells?limit=1', { cookie: workerLogin.cookie });
  cellId = cells.payload?.data?.items[0]?.id || '';
  assert.ok(cellId);

  const badPhotoType = await call(`/cells/${cellId}/photos`, {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: { title: 'invalid', url: 'data:text/html;base64,PGgxPmJhZDwvaDE+' },
  });
  assert.equal(badPhotoType.response.status, 400);
  assert.equal(badPhotoType.payload?.code, 'INVALID_PHOTO_TYPE');

  const badSignature = await call(`/cells/${cellId}/photos`, {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: { title: 'invalid signature', url: 'data:image/png;base64,QUFBQQ==' },
  });
  assert.equal(badSignature.response.status, 400);
  assert.equal(badSignature.payload?.code, 'INVALID_PHOTO_SIGNATURE');

  const validPhoto = await call<{ id: string }>(`/cells/${cellId}/photos`, {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: {
      title: 'security-test.png',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      category: 'test',
    },
  });
  assert.equal(validPhoto.response.status, 201);
  photoId = validPhoto.payload?.data?.id || '';
  const privatePhoto = await call(`/cells/${cellId}/photos/${photoId}/content`, { cookie: workerLogin.cookie });
  assert.equal(privatePhoto.response.status, 200);
  assert.equal(privatePhoto.response.headers.get('content-type'), 'image/png');
  assert.match(privatePhoto.response.headers.get('cache-control') || '', /private/);
  const anonymousPhoto = await call(`/cells/${cellId}/photos/${photoId}/content`);
  assert.equal(anonymousPhoto.response.status, 401);
  const workerPhotoDelete = await call(`/cells/${cellId}/photos/${photoId}`, { method: 'DELETE', cookie: workerLogin.cookie });
  assert.equal(workerPhotoDelete.response.status, 403);

  const forgedOrigin = await call('/auth/signup', {
    method: 'POST',
    origin: 'https://attacker.example',
    body: { username: 'not-created', password: 'Password123!', name: 'x', department: 'x' },
  });
  assert.equal(forgedOrigin.response.status, 403);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await call('/auth/login', { method: 'POST', body: { username: failedUsername, password: 'WrongPassword123!' } });
    assert.equal(failed.response.status, 401);
  }
  const locked = await call('/auth/login', { method: 'POST', body: { username: failedUsername, password: 'WrongPassword123!' } });
  assert.equal(locked.response.status, 429);
  assert.equal(locked.payload?.code, 'LOGIN_LOCKED');

  const adminLogin = await call('/auth/login', { method: 'POST', body: { username: 'user-5', password: '1234' } });
  assert.equal(adminLogin.response.status, 200);
  const oversizedImport = await call('/admin/db/validate', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      fileName: 'oversized.xlsx',
      fileSize: 100 * 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      records: [{}],
    },
  });
  assert.equal(oversizedImport.response.status, 400);
  assert.equal(oversizedImport.payload?.code, 'INVALID_FILE_SIZE');
  const executableUpload = await call('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { dbType: 'floor_plan', stationName: 'test', fileName: 'malware.exe', fileSize: 100, mimeType: 'application/octet-stream', records: [] },
  });
  assert.equal(executableUpload.response.status, 400);
  assert.equal(executableUpload.payload?.code, 'INVALID_FILE');
  const deleted = await call(`/cells/${cellId}/photos/${photoId}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(deleted.response.status, 200);

  const auditResponse = await call<{ items: unknown[] }>('/admin/audit-logs?limit=10', { cookie: adminLogin.cookie });
  assert.equal(auditResponse.response.status, 200);
  assert.ok((auditResponse.payload?.data?.items.length || 0) > 0);

  const auditCount = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs
     WHERE action IN ('SECURITY_FORBIDDEN_ACCESS', 'SECURITY_LOGIN_FAILED', 'PHOTO_UPLOADED')
  `).get() as { count: number }).count);
  assert.ok(auditCount >= 3);

  console.log('Security integration test passed: auth/RBAC, SQL binding, upload signatures, private photos, CSRF origin, lockout, headers, audit');
} finally {
  if (photoId) {
    const row = db.prepare('SELECT file_url FROM field_photos WHERE id = ?').get(photoId) as { file_url: string } | undefined;
    if (row) {
      const { removePrivatePhoto } = await import('../photo-storage');
      removePrivatePhoto(row.file_url);
    }
    db.prepare('DELETE FROM field_photos WHERE id = ?').run(photoId);
  }
  db.prepare('DELETE FROM login_attempts WHERE username = ?').run(failedUsername.toLowerCase());
  db.prepare('DELETE FROM login_attempts WHERE created_at >= ?').run(auditStart);
  db.prepare('DELETE FROM audit_logs WHERE created_at >= ?').run(auditStart);
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-5')").run();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
