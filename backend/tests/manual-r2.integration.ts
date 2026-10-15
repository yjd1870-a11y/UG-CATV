import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import type { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// No cloud credentials or network: exercise the existing R2 adapter against an in-memory SDK stub.
process.env.STORAGE_DRIVER = 'r2';
process.env.R2_ENDPOINT = 'https://manual-test.r2.cloudflarestorage.com';
process.env.R2_ACCESS_KEY_ID = 'test-access'; process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'manual-test';
const objects = new Map<string, Buffer>(); let failPut = false; let failDelete = false;
const originalSend = S3Client.prototype.send;
S3Client.prototype.send = (async function(command: any) {
  const key = command.input.Key;
  if (command instanceof PutObjectCommand) {
    assert.equal(command.input.StorageClass, 'STANDARD');
    const chunks: Buffer[] = []; for await (const chunk of command.input.Body as Readable) chunks.push(Buffer.from(chunk));
    if (failPut) throw new Error('Simulated R2 upload failure');
    objects.set(key, Buffer.concat(chunks)); return {};
  }
  if (command instanceof DeleteObjectCommand) { if (failDelete) throw new Error('Simulated R2 deletion failure'); objects.delete(key); return {}; }
  if (command instanceof HeadObjectCommand) { if (!objects.has(key)) throw new Error('No object'); return { ContentLength: objects.get(key)!.length, ContentType: 'video/mp4' }; }
  throw new Error('Unexpected SDK request');
}) as typeof S3Client.prototype.send;
const { db, initializeDatabase } = await import('../db');
const { env } = await import('../env');
assert.ok(env.databasePath.includes('test-runs'));
await initializeDatabase();
const { createApiApp } = await import('../app');
const { purgeManualStorage } = await import('../manual-storage');
const server = createApiApp().listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
const base = `http://127.0.0.1:${address.port}`;
let cookie = '';
const request = async (route: string, method = 'GET', body?: unknown) => {
  const response = await fetch(`${base}/api${route}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { response, payload: await response.json() };
};
try {
  cookie = (await request('/auth/login', 'POST', { username: 'user-5', password: '1234' })).response.headers.get('set-cookie')!.split(';')[0];
  const model = (await request('/manual/models', 'POST', { categoryId: 'otdr', name: 'R2 isolated model' })).payload.data;
  const bytes = fs.readFileSync(new URL('./fixtures/manual-playback.mp4', import.meta.url));
  const upload = async () => {
    const reserved = (await request(`/manual/models/${model.id}/uploads`, 'POST', { kind: 'video', title: '측정 화면', fileName: 'guide.mp4', mime: 'video/mp4', bytes: bytes.length })).payload.data;
    const response = await fetch(base + reserved.uploadUrl, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'video/mp4' }, body: bytes });
    await response.text(); return { id: reserved.id, status: response.status };
  };
  const asset = await upload(); assert.equal(asset.status, 200); assert.equal(objects.size, 1);
  const content = await fetch(`${base}/api/manual/assets/${asset.id}/content`, { headers: { Cookie: cookie, Range: 'bytes=100-' }, redirect: 'manual' });
  assert.equal(content.status, 302);
  const signed = new URL(content.headers.get('location')!);
  assert.equal(signed.hostname, 'manual-test.manual-test.r2.cloudflarestorage.com');
  assert.ok(signed.searchParams.get('X-Amz-Signature')); assert.equal(signed.searchParams.get('X-Amz-Expires'), String(env.r2SignedUrlTtlSeconds));
  const head = await fetch(`${base}/api/manual/assets/${asset.id}/content`, { method: 'HEAD', headers: { Cookie: cookie } });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(bytes.length));
  const download = await fetch(`${base}/api/manual/assets/${asset.id}/content?download=1`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.ok(new URL(download.headers.get('location')!).searchParams.get('response-content-disposition')?.startsWith('attachment'));
  failPut = true; const failed = await upload(); assert.equal(failed.status, 500); failPut = false;
  assert.equal((db.prepare('SELECT status FROM manual_assets WHERE id = ?').get(failed.id) as any).status, 'deleted');
  assert.equal((await request(`/manual/models/${model.id}`)).payload.data.assets.length, 1);
  failDelete = true; assert.equal((await request(`/manual/assets/${asset.id}`, 'DELETE')).response.status, 200);
  const ledger = db.prepare('SELECT purged_at,purge_attempts FROM manual_assets WHERE id = ?').get(asset.id) as any;
  assert.equal(ledger.purged_at, null); assert.ok(ledger.purge_attempts > 0); assert.equal(objects.size, 1);
  assert.equal((await fetch(`${base}/api/manual/assets/${asset.id}/content`, { headers: { Cookie: cookie } })).status, 404);
  failDelete = false; await purgeManualStorage(); assert.equal(objects.size, 0);
  assert.ok((db.prepare('SELECT purged_at FROM manual_assets WHERE id = ?').get(asset.id) as any).purged_at);
  const compressed = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#009688' } }).webp({ quality: 85 }).toBuffer();
  const photo = (await request(`/manual/models/${model.id}/uploads`, 'POST', { kind: 'photo', title: '압축 사진', fileName: '압축사진.webp', mime: 'image/webp', bytes: compressed.length })).payload.data;
  const photoUpload = await fetch(base + photo.uploadUrl, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'image/webp' }, body: compressed });
  assert.equal(photoUpload.status, 200); await photoUpload.text();
  const record = db.prepare('SELECT object_key,mime,bytes,file_name FROM manual_assets WHERE id = ?').get(photo.id) as any;
  assert.ok(record.object_key.endsWith('.webp')); assert.equal(record.mime, 'image/webp'); assert.equal(record.bytes, compressed.length); assert.equal(record.file_name, '압축사진.webp');
  assert.deepEqual(objects.get(record.object_key), compressed);
  console.log('Manual R2 adapter passed: authenticated signed redirect, HEAD, download disposition, failed upload rollback and deletion retry.');
} finally { S3Client.prototype.send = originalSend; await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); }
