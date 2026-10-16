import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { env } from '../env';
import { migrateManualSchema } from '../database/manual-schema';
import { purgeManualStorage } from '../manual-storage';

assert.equal(env.storageDriver, 'local');
assert.ok(env.databasePath.includes('test-runs'), 'Only use the isolated test DB.');
await initializeDatabase();
const app = createApiApp();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server');
const base = `http://127.0.0.1:${address.port}/api`;
const call = async (url: string, method = 'GET', body?: unknown, cookie = '') => {
  const response = await fetch(base + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json(); return { status: response.status, data: payload.data, cookie: response.headers.get('set-cookie')?.split(';')[0] || '', payload };
};
try {
  const admin = (await call('/auth/login', 'POST', { username: 'user-5', password: '1234' })).cookie;
  const reader = (await call('/auth/login', 'POST', { username: 'user-1', password: '1234' })).cookie;
  assert.ok(admin); assert.ok(reader);
  assert.equal((await call('/manual/categories')).status, 401);
  const categories = await call('/manual/categories', 'GET', undefined, admin);
  assert.equal(categories.data.items.length, 4); assert.equal(categories.data.canManage, true);
  assert.equal((await call('/manual/categories/otdr/models', 'GET', undefined, admin)).data.length, 0);
  migrateManualSchema(db); migrateManualSchema(db);
  assert.equal((await call('/manual/categories', 'GET', undefined, admin)).data.items.length, 4);
  assert.equal((await call('/manual/models', 'POST', { categoryId: 'otdr', name: 'forbidden' }, reader)).status, 403);
  const a = (await call('/manual/models', 'POST', { categoryId: 'otdr', name: '테스트 광선로 모델', manufacturer: '테스트 제조사' }, admin)).data;
  const b = (await call('/manual/models', 'POST', { categoryId: 'rf-meter', name: '테스트 RF 모델' }, admin)).data;
  assert.equal((await call('/manual/categories/otdr/models', 'GET', undefined, admin)).data[0].id, a.id);
  const body = '연결 상태를 확인하세요.\n<script>window.__manualXss = true</script>';
  const saved = await call(`/manual/models/${a.id}/text`, 'PUT', { body, tips: '현장 팁', version: 1 }, admin);
  assert.equal(saved.status, 200); assert.equal(saved.data.body, body);
  assert.equal((await call(`/manual/models/${a.id}/text`, 'PUT', { body: 'overwrite', version: 1 }, admin)).status, 409);
  assert.equal((await call(`/manual/models/${a.id}/text`, 'PUT', { body: 'overwrite', version: 2 }, reader)).status, 403);
  assert.equal((await call(`/manual/models/${b.id}`, 'GET', undefined, reader)).data.model.body, '');
  assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, reader)).data.canManage, false);
  const upload = async (kind: string, bytes: Buffer, mime: string, filename: string, posterId?: string, expected = 200, purpose = 'manual') => {
    const reserved = await call(`/manual/models/${a.id}/uploads`, 'POST', { kind, bytes: bytes.length, mime, fileName: filename, title: filename, posterId, purpose }, admin);
    assert.equal(reserved.status, 201, JSON.stringify(reserved.payload));
    const response = await fetch(base.replace(/\/api$/, '') + reserved.data.uploadUrl, { method: 'PUT', headers: { Cookie: admin, 'Content-Type': mime }, body: bytes as unknown as BodyInit });
    assert.equal(response.status, expected, await response.text()); return reserved.data.id as string;
  };
  const jpg = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#0d9488' } }).jpeg().toBuffer();
  const photo = await upload('photo', jpg, 'image/jpeg', '장비사진.jpg');
  assert.equal((await call(`/manual/models/${a.id}/image`, 'PUT', { assetId: photo }, reader)).status, 403);
  assert.equal((await call(`/manual/models/${b.id}/image`, 'PUT', { assetId: photo }, admin)).status, 400);
  assert.equal((await call(`/manual/models/${a.id}/image`, 'PUT', { assetId: photo }, admin)).status, 400);
  const replacement = await upload('photo', jpg, 'image/jpeg', '대표사진.jpg', undefined, 200, 'model-cover');
  assert.equal((await call(`/manual/models/${a.id}/image`, 'PUT', { assetId: replacement }, admin)).status, 200);
  migrateManualSchema(db);
  assert.ok((await call('/manual/categories/otdr/models', 'GET', undefined, reader)).data[0].imageUrl.includes(replacement));
  assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, reader)).data.assets.find((x: any) => x.id === replacement).purpose, 'model-cover');
  const changedCover = await upload('photo', jpg, 'image/jpeg', '교체사진.jpg', undefined, 200, 'model-cover');
  await call(`/manual/models/${a.id}/image`, 'PUT', { assetId: changedCover }, admin);
  assert.equal((await fetch(`${base}/manual/assets/${replacement}/content`, { headers: { Cookie: reader } })).status, 404);
  await call(`/manual/assets/${changedCover}`, 'DELETE', undefined, admin);
  assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, reader)).data.model.imageUrl, null);
  const pdf = await upload('pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'), 'application/pdf', '설명서.pdf');
  await upload('photo', Buffer.from('this is not a jpeg'), 'image/jpeg', 'invalid.jpg', undefined, 400);
  await upload('pdf', Buffer.from('<html>fake pdf</html>'), 'application/pdf', 'invalid.pdf', undefined, 400);
  await upload('video', Buffer.from('not a video'), 'video/mp4', 'invalid.mp4', undefined, 400);
  assert.equal((await call(`/manual/models/${a.id}/uploads`, 'POST', { kind: '__proto__', title: 'bad' }, admin)).status, 400);
  assert.equal((await call(`/manual/models/${a.id}/uploads`, 'POST', { kind: 'video', mime: 'video/mp4', bytes: 201 * 1048576, fileName: 'large.mp4', title: 'large' }, admin)).status, 413);
  const videoFile = new URL('./fixtures/manual-playback.mp4', import.meta.url);
  const mp4 = fs.readFileSync(videoFile); const videoIds: string[] = [];
  const poster = await upload('thumbnail', jpg, 'image/jpeg', '동영상썸네일.jpg');
  assert.equal((await call(`/manual/models/${a.id}/uploads`, 'POST', { kind: 'video', mime: 'video/mp4', bytes: mp4.length, fileName: 'wrong-poster.mp4', title: 'test', posterId: photo }, admin)).status, 400);
  for (let i = 0; i < 4; i++) videoIds.push(await upload('video', mp4, 'video/mp4', `가이드-${i}.mp4`, poster));
  assert.equal((await call(`/manual/models/${a.id}/uploads`, 'POST', { kind: 'video', mime: 'video/mp4', bytes: mp4.length, fileName: 'fifth.mp4', title: 'fifth' }, admin)).status, 409);
  assert.equal((await call(`/manual/models/${b.id}/uploads`, 'POST', { kind: 'video', mime: 'video/mp4', bytes: mp4.length, fileName: 'cross.mp4', title: 'cross', posterId: photo }, admin)).status, 400);
  for (const id of videoIds) {
    const partial = await fetch(`${base}/manual/assets/${id}/content`, { headers: { Cookie: reader, Range: 'bytes=16-31' } });
    assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), `bytes 16-31/${mp4.length}`);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), mp4.subarray(16, 32));
  }
  const badRange = await fetch(`${base}/manual/assets/${videoIds[0]}/content`, { headers: { Cookie: reader, Range: 'bytes=999999999-' } }); assert.equal(badRange.status, 416);
  const suffix = await fetch(`${base}/manual/assets/${videoIds[0]}/content`, { headers: { Cookie: reader, Range: 'bytes=-8' } }); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), mp4.subarray(-8));
  assert.equal((await fetch(`${base}/manual/assets/${photo}/content`)).status, 401);
  const download = await fetch(`${base}/manual/assets/${pdf}/content?download=1`, { headers: { Cookie: reader } }); assert.equal(download.status, 200); assert.ok(download.headers.get('content-disposition')?.startsWith('attachment'));
  assert.equal((await call(`/manual/assets/${photo}`, 'DELETE', undefined, reader)).status, 403);
  assert.equal((await call(`/manual/assets/${photo}`, 'PATCH', { title: '연결 위치' }, admin)).status, 200);
  assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, admin)).data.assets.find((x: any) => x.id === photo).title, '연결 위치');
  await call(`/manual/assets/${photo}`, 'DELETE', undefined, admin);
  await call(`/manual/assets/${poster}`, 'DELETE', undefined, admin);
  assert.equal((await fetch(`${base}/manual/assets/${photo}/content`, { headers: { Cookie: reader } })).status, 404);
  const afterPhoto = (await call(`/manual/models/${a.id}`, 'GET', undefined, admin)).data;
  assert.equal(afterPhoto.assets.find((x: any) => x.kind === 'video').posterId, null);
  assert.equal((await call('/manual/categories/otdr', 'DELETE', undefined, admin)).status, 409);
  const pending = (await call(`/manual/models/${b.id}/uploads`, 'POST', { kind: 'photo', mime: 'image/jpeg', bytes: jpg.length, fileName: 'pending.jpg', title: 'pending' }, admin)).data;
  db.prepare("UPDATE manual_assets SET expires_at = '2000-01-01' WHERE id = ?").run(pending.id); await purgeManualStorage();
  assert.equal((db.prepare('SELECT status FROM manual_assets WHERE id = ?').get(pending.id) as any).status, 'deleted');
  // Simulated missing file: no ready record may be served as a successful response.
  const record = db.prepare('SELECT object_key FROM manual_assets WHERE id = ?').get(pdf) as any;
  fs.unlinkSync(path.join(env.privateStoragePath, record.object_key));
  assert.equal((await fetch(`${base}/manual/assets/${pdf}/content`, { headers: { Cookie: reader } })).status, 404);
  const ledger = db.prepare("SELECT COUNT(*) AS n FROM manual_assets WHERE status = 'deleted' AND purged_at IS NULL").get() as any;
  assert.equal(ledger.n, 0);
  assert.equal((await call(`/manual/models/${a.id}`, 'DELETE', undefined, admin)).status, 200);
  assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, reader)).status, 404);
  assert.equal((await call(`/manual/models/${b.id}`, 'GET', undefined, reader)).status, 200);
  // Deleted equipment names can be registered again, including seeded categories.
  for (const equipment of [{ id: 'otdr', name: 'OTDR' }, { id: '', name: '재등록 검증 장비' }]) {
    let categoryId = equipment.id;
    if (!categoryId) {
      const created = await call('/manual/categories', 'POST', { name: equipment.name }, admin);
      assert.equal(created.status, 201); categoryId = created.data.id;
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      assert.equal((await call(`/manual/categories/${categoryId}`, 'DELETE', undefined, reader)).status, 403);
      assert.equal((await call(`/manual/categories/${categoryId}`, 'DELETE', undefined, admin)).status, 200);
      assert.equal((await call('/manual/categories', 'GET', undefined, reader)).data.items.some((item: any) => item.id === categoryId), false);
      assert.equal((await call('/manual/categories', 'POST', { name: equipment.name }, reader)).status, 403);
      const description = `재등록 설명 ${cycle}`;
      const registered = await call('/manual/categories', 'POST', { name: equipment.name, description }, admin);
      assert.equal(registered.status, 201); assert.equal(registered.data.id, categoryId);
      assert.equal((await call('/manual/categories', 'POST', { name: equipment.name }, admin)).status, 409);
      migrateManualSchema(db); migrateManualSchema(db);
      const visible = (await call('/manual/categories', 'GET', undefined, reader)).data.items.filter((item: any) => item.name === equipment.name);
      assert.equal(visible.length, 1); assert.equal(visible[0].description, description);
      assert.deepEqual((await call(`/manual/categories/${categoryId}/models`, 'GET', undefined, reader)).data, []);
      assert.equal((await call(`/manual/models/${a.id}`, 'GET', undefined, reader)).status, 404);
      assert.equal((await fetch(`${base}/manual/assets/${videoIds[0]}/content`, { headers: { Cookie: reader } })).status, 404);
    }
    const model = await call('/manual/models', 'POST', { categoryId, name: '재등록 후 새 모델' }, admin);
    assert.equal(model.status, 201);
    assert.equal((await call(`/manual/categories/${categoryId}/models`, 'GET', undefined, reader)).data[0].id, model.data.id);
    assert.equal((await call(`/manual/categories/${categoryId}`, 'DELETE', undefined, admin)).status, 409);
  }
  console.log('Manual integration passed: isolation, migrations, persisted text, version conflict, auth, uploads, validation, 4 videos, ranges, deletion and cleanup.');
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); }
