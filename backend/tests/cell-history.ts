import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import sharp from 'sharp';
import fs from 'node:fs';
import { resolvePrivatePhoto } from '../photo-storage';

await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start.');
const base = `http://127.0.0.1:${address.port}/api`;

type Envelope<T> = { success: boolean; data?: T; message?: string };
const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as Envelope<T>;
  return { response, payload };
};
const login = async (username: string) => {
  const result = await call('/auth/login', { method: 'POST', body: { username, password: '1234' } });
  assert.equal(result.response.status, 200);
  return result.response.headers.get('set-cookie')?.split(';')[0] || '';
};

let historyId = '';
try {
  const [managerCookie, otherManagerCookie] = await Promise.all([login('user-1'), login('user-3')]);
  const cell = db.prepare('SELECT id FROM cells WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() as { id: string };
  assert.ok(cell.id);
  const originalBuffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#2878B5' } }).png().toBuffer();
  const updatedBuffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#F28C28' } }).jpeg().toBuffer();
  const originalPhoto = `data:image/png;base64,${originalBuffer.toString('base64')}`;
  const updatedPhoto = `data:image/jpeg;base64,${updatedBuffer.toString('base64')}`;
  const created = await call<{ id: string }>(`/cells/${cell.id}/history`, {
    method: 'POST', cookie: managerCookie,
    body: { title: '드래그 사진 작업', type: '현장작업', date: '2026-08-28', worker: '임의 이름', summary: '등록 내용', status: '완료', photos: [originalPhoto] },
  });
  assert.equal(created.response.status, 201);
  historyId = created.payload.data?.id || '';
  assert.ok(historyId);
  const originalAsset = db.prepare(`SELECT id,object_key AS objectKey,thumbnail_object_key AS thumbnailObjectKey FROM cell_history_photo_assets WHERE history_id=? AND deleted_at IS NULL`).get(historyId) as { id: string; objectKey: string; thumbnailObjectKey: string };
  assert.ok(fs.existsSync(resolvePrivatePhoto(originalAsset.objectKey)));
  assert.ok(fs.existsSync(resolvePrivatePhoto(originalAsset.thumbnailObjectKey)));

  const forbidden = await call(`/cells/${cell.id}/history/${historyId}`, {
    method: 'PUT', cookie: otherManagerCookie, body: { summary: '타 작업자 수정' },
  });
  assert.equal(forbidden.response.status, 403);

  const updated = await call(`/cells/${cell.id}/history/${historyId}`, {
    method: 'PUT', cookie: managerCookie,
    body: { title: '수정된 작업이력', type: '현장작업', date: '2026-08-29', summary: '수정 내용', photos: [updatedPhoto] },
  });
  assert.equal(updated.response.status, 200);
  const detail = await call<{ history: Array<{ id: string; title: string; summary: string; photos: string[] }> }>(`/cells/${cell.id}/transmission`, { cookie: managerCookie });
  const saved = detail.payload.data?.history.find((item) => item.id === historyId);
  assert.equal(saved?.title, '수정된 작업이력');
  assert.equal(saved?.summary, '수정 내용');
  assert.equal(saved?.photos.length, 1);
  assert.match(saved?.photos[0] || '', new RegExp(`/history/${historyId}/photos/.+/content\\?variant=thumbnail$`));
  const replacementAsset = db.prepare(`SELECT id,object_key AS objectKey,thumbnail_object_key AS thumbnailObjectKey FROM cell_history_photo_assets WHERE history_id=? AND deleted_at IS NULL`).get(historyId) as { id: string; objectKey: string; thumbnailObjectKey: string };
  assert.notEqual(replacementAsset.id, originalAsset.id);
  assert.equal(fs.existsSync(resolvePrivatePhoto(originalAsset.objectKey)), false);
  assert.equal(fs.existsSync(resolvePrivatePhoto(originalAsset.thumbnailObjectKey)), false);

  const deleted = await call(`/cells/${cell.id}/history/${historyId}`, { method: 'DELETE', cookie: managerCookie });
  assert.equal(deleted.response.status, 200);
  const hidden = await call<{ history: Array<{ id: string }> }>(`/cells/${cell.id}/transmission`, { cookie: managerCookie });
  assert.equal(hidden.payload.data?.history.some((item) => item.id === historyId), false);
  assert.equal(fs.existsSync(resolvePrivatePhoto(replacementAsset.objectKey)), false);
  assert.equal(fs.existsSync(resolvePrivatePhoto(replacementAsset.thumbnailObjectKey)), false);
  console.log('CELL history test passed: create → owner edit with photo replacement → delete and cross-user protection');
} finally {
  if (historyId) {
    db.prepare('DELETE FROM cell_history_photo_assets WHERE history_id = ?').run(historyId);
    db.prepare('DELETE FROM cell_work_history WHERE id = ?').run(historyId);
  }
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-3')").run();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
