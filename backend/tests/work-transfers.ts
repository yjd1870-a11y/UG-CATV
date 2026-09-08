import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { resolvePrivatePhoto } from '../photo-storage';

await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start.');
const base = `http://127.0.0.1:${address.port}/api`;
type Envelope<T> = { success: boolean; data?: T; message?: string; code?: string };
const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as Envelope<T>;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
};
const login = async (username: string) => {
  const result = await call('/auth/login', { method: 'POST', body: { username, password: '1234' } });
  assert.equal(result.response.status, 200); assert.ok(result.cookie); return result.cookie;
};

const createdIds: string[] = [];
try {
  for (const [index, name] of ['평택안성', '용인', '수원', '오산화성'].entries()) {
    db.prepare('INSERT INTO regions (id, region_name, sort_order, active) VALUES (?, ?, ?, 1) ON CONFLICT(region_name) DO UPDATE SET active = 1').run(`transfer-region-${index}`, name, index + 1);
  }
  const suwon = db.prepare("SELECT id FROM regions WHERE region_name = '수원'").get() as { id: string };
  const yongin = db.prepare("SELECT id FROM regions WHERE region_name = '용인'").get() as { id: string };
  db.prepare("UPDATE users SET region_id = ? WHERE id IN ('user-1', 'user-4')").run(suwon.id);
  db.prepare("UPDATE users SET region_id = ? WHERE id = 'user-3'").run(yongin.id);
  db.prepare("UPDATE users SET access_role = 'public_official', region_id = ? WHERE id = 'user-2'").run(yongin.id);
  const [adminCookie, teamCookie, publicCookie, managerCookie, otherManagerCookie] = await Promise.all([login('user-5'), login('user-4'), login('user-2'), login('user-1'), login('user-3')]);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const photo = (name = 'evidence.png') => ({ fileName: name, dataUrl: png });

  const meta = await call<{ regions: Array<{ name: string }> }>('/work-transfers/meta', { cookie: adminCookie });
  assert.deepEqual(meta.payload.data?.regions.map((region) => region.name), ['평택안성', '용인', '수원', '오산화성']);
  const teamMeta = await call<{ regions: Array<{ name: string }> }>('/work-transfers/meta', { cookie: teamCookie });
  assert.deepEqual(teamMeta.payload.data?.regions.map((region) => region.name), ['평택안성', '용인', '수원', '오산화성']);

  const noPhoto = await call('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id } });
  assert.equal(noPhoto.response.status, 400); assert.equal(noPhoto.payload.code, 'PHOTO_COUNT_INVALID');
  const tooMany = await call('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, requestPhotos: [1, 2, 3, 4].map((n) => photo(`${n}.png`)) } });
  assert.equal(tooMany.response.status, 400);
  const invalidMime = await call('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, requestPhotos: [{ fileName: 'not-photo.txt', dataUrl: 'data:text/plain;base64,dGVzdA==' }] } });
  assert.equal(invalidMime.response.status, 400);
  const oversizedPng = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10 * 1024 * 1024)]).toString('base64')}`;
  const oversized = await call('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, requestPhotos: [{ fileName: 'oversized.png', dataUrl: oversizedPng }] } });
  assert.equal(oversized.response.status, 400); assert.equal(oversized.payload.code, 'INVALID_PHOTO_SIZE');
  const invalidDate = await call('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, inspectionRequestedDate: '2026-02-30', requestPhotos: [photo()] } });
  assert.equal(invalidDate.response.status, 400);
  const otherRegion = await call<{ id: string }>('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: yongin.id, requestPhotos: [photo()] } });
  assert.equal(otherRegion.response.status, 201); createdIds.push(otherRegion.payload.data?.id || '');
  const unknownRegion = await call('/work-transfers', { method: 'POST', cookie: adminCookie, body: { regionId: 'unknown-region', requestPhotos: [photo()] } });
  assert.equal(unknownRegion.response.status, 400); assert.equal(unknownRegion.payload.code, 'INVALID_REGION');

  const defaultDate = await call<{ id: string; inspectionRequestedDate: string; customerAddress: string }>('/work-transfers', {
    method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, customerAddress: '', clientRegistrationKey: 'default-date-key', requestPhotos: [photo()] },
  });
  assert.equal(defaultDate.response.status, 201); createdIds.push(defaultDate.payload.data?.id || '');
  const koreaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(defaultDate.payload.data?.inspectionRequestedDate, koreaToday); assert.equal(defaultDate.payload.data?.customerAddress, '');

  const threePhotos = await call<{ id: string; attachments: unknown[] }>('/work-transfers', {
    method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, requestPhotos: [photo('one-of-three.png'), photo('two-of-three.png'), photo('three-of-three.png')] },
  });
  assert.equal(threePhotos.response.status, 201); assert.equal(threePhotos.payload.data?.attachments.length, 3);
  createdIds.push(threePhotos.payload.data?.id || '');

  const duplicate = await call<{ id: string }>('/work-transfers', {
    method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, clientRegistrationKey: 'default-date-key', requestPhotos: [photo('retry.png')] },
  });
  assert.equal(duplicate.response.status, 200); assert.equal(duplicate.payload.data?.id, defaultDate.payload.data?.id);

  const created = await call<Record<string, unknown> & { id: string; attachments: Array<{ id: string; url: string }> }>('/work-transfers', {
    method: 'POST', cookie: teamCookie,
    body: { regionId: suwon.id, inspectionRequestedDate: '2026-08-25', customerAddress: '', isUrgent: true, requestPhotos: [photo('one.png'), photo('two.png')] },
  });
  assert.equal(created.response.status, 201); const transferId = created.payload.data?.id || ''; createdIds.push(transferId);
  assert.equal(created.payload.data?.customerAddress, ''); assert.equal(created.payload.data?.workflowStatus, 'registered');
  assert.equal(created.payload.data?.attachments.length, 2);

  const blankUpdate = await call<{ customerAddress: string }>(`/work-transfers/${transferId}`, { method: 'PUT', cookie: teamCookie, body: { customerAddress: '', inspectionRequestedDate: '2026-08-26' } });
  assert.equal(blankUpdate.response.status, 200); assert.equal(blankUpdate.payload.data?.customerAddress, '');
  const managerUpdate = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: managerCookie, body: { customerAddress: '차단' } });
  assert.equal(managerUpdate.response.status, 403);
  const teamOtherRegionUpdate = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: teamCookie, body: { regionId: yongin.id } });
  assert.equal(teamOtherRegionUpdate.response.status, 200);
  const adminRegionUpdate = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: adminCookie, body: { regionId: yongin.id, customerAddress: '용인 주소' } });
  assert.equal(adminRegionUpdate.response.status, 200);
  const publicUpdate = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: publicCookie, body: { regionId: suwon.id, customerAddress: '공무 수정 주소' } });
  assert.equal(publicUpdate.response.status, 200);

  const detail = await call<{ attachments: Array<{ id: string; url: string }> }>(`/work-transfers/${transferId}`, { cookie: managerCookie });
  assert.equal(detail.response.status, 200);
  const stored = db.prepare('SELECT file_url FROM work_transfer_attachments WHERE transfer_id = ?').all(transferId) as Array<{ file_url: string }>;
  assert.equal(stored.length, 2); for (const item of stored) assert.equal(fs.existsSync(resolvePrivatePhoto(item.file_url)), true);
  const photoResponse = await fetch(`${base}${detail.payload.data?.attachments[0].url}`, { headers: { Cookie: managerCookie } });
  assert.equal(photoResponse.status, 200);
  const otherManagerPhoto = await fetch(`${base}${detail.payload.data?.attachments[0].url}`, { headers: { Cookie: otherManagerCookie } });
  assert.equal(otherManagerPhoto.status, 404);

  const premature = await call(`/work-transfers/${transferId}/complete`, { method: 'POST', cookie: teamCookie });
  assert.equal(premature.response.status, 409);
  const processed = await call<{ workflowStatus: string }>(`/work-transfers/${transferId}/field-actions`, { method: 'POST', cookie: managerCookie, body: { actionText: '현장 처리 완료' } });
  assert.equal(processed.response.status, 201); assert.equal(processed.payload.data?.workflowStatus, 'field_processed');
  const managerHidden = await call(`/work-transfers/${transferId}`, { cookie: managerCookie });
  assert.equal(managerHidden.response.status, 404);
  const managerPhotoHidden = await fetch(`${base}${detail.payload.data?.attachments[0].url}`, { headers: { Cookie: managerCookie } });
  assert.equal(managerPhotoHidden.status, 404);
  const managerList = await call<Array<{ id: string }>>('/work-transfers', { cookie: managerCookie });
  assert.equal(managerList.payload.data?.some((item) => item.id === transferId), false);
  const managerSummary = await call<{ registered: number; field_processed: number; completed: number }>('/work-transfers/summary', { cookie: managerCookie });
  assert.equal(managerSummary.payload.data?.field_processed, 0); assert.equal(managerSummary.payload.data?.completed, 0);

  const completed = await call<{ workflowStatus: string; attachments: unknown[]; evidencePhotosDeletedAt: string }>(`/work-transfers/${transferId}/complete`, { method: 'POST', cookie: teamCookie });
  assert.equal(completed.response.status, 200); assert.equal(completed.payload.data?.workflowStatus, 'completed'); assert.deepEqual(completed.payload.data?.attachments, []); assert.ok(completed.payload.data?.evidencePhotosDeletedAt);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM work_transfer_attachments WHERE transfer_id = ?').get(transferId) as { count: number }).count, 0);
  for (const item of stored) assert.equal(fs.existsSync(resolvePrivatePhoto(item.file_url)), false);
  const defaultList = await call<Array<{ id: string; workflowStatus: string }>>('/work-transfers', { cookie: adminCookie });
  assert.equal(defaultList.response.status, 200); assert.ok(defaultList.payload.data?.every((item) => item.workflowStatus !== 'completed'));
  const completedList = await call<Array<{ id: string; workflowStatus: string; completedAt?: string }>>('/work-transfers?status=completed', { cookie: adminCookie });
  assert.equal(completedList.response.status, 200); assert.ok(completedList.payload.data?.some((item) => item.id === transferId));
  assert.ok(completedList.payload.data?.every((item) => item.workflowStatus === 'completed'));
  const completedTimes = completedList.payload.data?.map((item) => item.completedAt || '') || [];
  assert.deepEqual(completedTimes, [...completedTimes].sort((left, right) => right.localeCompare(left)));
  const completedUpdate = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: adminCookie, body: { customerAddress: '차단' } });
  assert.equal(completedUpdate.response.status, 409);

  const purgeFailureCreate = await call<{ id: string }>('/work-transfers', { method: 'POST', cookie: teamCookie, body: { regionId: suwon.id, requestPhotos: [photo('purge-failure.png')] } });
  assert.equal(purgeFailureCreate.response.status, 201);
  const purgeFailureId = purgeFailureCreate.payload.data?.id || ''; createdIds.push(purgeFailureId);
  const purgeFailureAction = await call(`/work-transfers/${purgeFailureId}/field-actions`, { method: 'POST', cookie: managerCookie, body: { actionText: '삭제 실패 검증용 처리' } });
  assert.equal(purgeFailureAction.response.status, 201);
  const purgeFailureAttachment = db.prepare('SELECT file_url FROM work_transfer_attachments WHERE transfer_id = ?').get(purgeFailureId) as { file_url: string };
  const purgeFailurePath = resolvePrivatePhoto(purgeFailureAttachment.file_url);
  fs.unlinkSync(purgeFailurePath); fs.mkdirSync(purgeFailurePath);
  try {
    const purgeFailure = await call(`/work-transfers/${purgeFailureId}/complete`, { method: 'POST', cookie: teamCookie });
    assert.equal(purgeFailure.response.status, 503); assert.equal(purgeFailure.payload.code, 'PHOTO_PURGE_FAILED');
    const afterFailure = db.prepare('SELECT workflow_status AS workflowStatus FROM work_transfers WHERE id = ?').get(purgeFailureId) as { workflowStatus: string };
    assert.equal(afterFailure.workflowStatus, 'field_processed');
  } finally {
    fs.rmdirSync(purgeFailurePath);
  }

  console.log('Work-transfer test passed: regions, optional address, photo limits, idempotency, inline permissions, manager scope, and atomic photo purge');
} finally {
  for (const id of createdIds.filter(Boolean)) db.prepare('DELETE FROM work_transfers WHERE id = ?').run(id);
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-2', 'user-3', 'user-4', 'user-5')").run();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
