import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';

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
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as Envelope<T>;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
};

const login = async (username: string) => {
  const result = await call('/auth/login', { method: 'POST', body: { username, password: '1234' } });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result.cookie || '';
};

let transferId = '';
try {
  const [adminCookie, teamCookie, managerCookie, otherManagerCookie] = await Promise.all([
    login('user-5'), login('user-4'), login('user-1'), login('user-3'),
  ]);
  const teamRegion = db.prepare('SELECT region_id AS regionId FROM users WHERE id = ?').get('user-4') as { regionId: string };
  const otherRegion = db.prepare('SELECT region_id AS regionId FROM users WHERE id = ?').get('user-3') as { regionId: string };
  assert.ok(teamRegion.regionId);
  assert.notEqual(teamRegion.regionId, otherRegion.regionId);
  const photoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const ocrPreview = await call('/work-transfers/ocr-preview', {
    method: 'POST', cookie: teamCookie, body: { imageDataUrl: photoDataUrl },
  });
  assert.equal(ocrPreview.response.status, 410);
  assert.equal(ocrPreview.payload.code, 'BROWSER_OCR_ONLY');

  const forbiddenCreate = await call('/work-transfers', {
    method: 'POST', cookie: teamCookie,
    body: { regionId: otherRegion.regionId, location: '타지역 주소', requestDetails: '타지역 등록', ocrText: '수기 원문' },
  });
  assert.equal(forbiddenCreate.response.status, 404);

  const created = await call<{ id: string; workflowStatus: string }>('/work-transfers', {
    method: 'POST', cookie: teamCookie,
    body: {
      regionId: teamRegion.regionId, branchName: 'HNS화성지점', requesterName: '이창수',
      inspectionRequestedDate: '2026-08-25', customerAddress: '오산 테스트 현장',
      handoverReason: '신호점검', inspectionRequestDetails: '케이블 현장 조치 요청 MER BER 확인',
      preActionNotes: 'ONU 7C RFOG 확인', tapRnLocation: 'TAP 3번', poleNumber: '12-34', leadInLength: '45m',
      ocrText: '오산 테스트 현장 케이블 현장 조치 요청', isUrgent: true,
      ocrStatus: 'succeeded', ocrEngine: 'browser-tesseract-kor-eng',
      requestPhotos: [{ fileName: 'evidence.png', dataUrl: photoDataUrl }],
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.data?.workflowStatus, 'registered');
  transferId = created.payload.data?.id || '';
  const detail = await call<{
    attachments: Array<{ id: string; url: string }>;
    branchName: string; inspectionRequestedDate: string; inspectionCompany: string; mediaType: string; preActionNotes: string;
    fieldActions: unknown[];
  }>(`/work-transfers/${transferId}`, { cookie: teamCookie });
  assert.equal(detail.payload.data?.attachments.length, 1);
  assert.equal(detail.payload.data?.branchName, 'HNS화성지점');
  assert.equal(detail.payload.data?.inspectionRequestedDate, '2026-08-25');
  assert.equal(detail.payload.data?.inspectionCompany, '유지텔레컴');
  assert.equal(detail.payload.data?.mediaType, 'CABLE');
  assert.equal(detail.payload.data?.preActionNotes, 'ONU 7C RFOG 확인');
  assert.equal(detail.payload.data?.fieldActions.length, 0);
  const ocrRun = db.prepare(`
    SELECT attachment_id, engine, status FROM work_transfer_ocr_runs WHERE transfer_id = ?
  `).get(transferId) as { attachment_id: string | null; engine: string; status: string };
  assert.equal(ocrRun.attachment_id, null);
  assert.equal(ocrRun.engine, 'browser-tesseract-kor-eng');
  assert.equal(ocrRun.status, 'succeeded');
  const photoResponse = await fetch(`${base}${detail.payload.data?.attachments[0].url}`, { headers: { Cookie: teamCookie } });
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get('content-type'), 'image/png');

  const managerList = await call<Array<{ id: string }>>('/work-transfers', { cookie: managerCookie });
  assert.ok(managerList.payload.data?.some((item) => item.id === transferId));
  const otherManagerDetail = await call(`/work-transfers/${transferId}`, { cookie: otherManagerCookie });
  assert.equal(otherManagerDetail.response.status, 404);

  const prematureComplete = await call(`/work-transfers/${transferId}/complete`, { method: 'POST', cookie: teamCookie });
  assert.equal(prematureComplete.response.status, 409);
  assert.equal(prematureComplete.payload.code, 'FIELD_ACTION_REQUIRED');

  const fieldAction = await call<{ workflowStatus: string }>(`/work-transfers/${transferId}/field-actions`, {
    method: 'POST', cookie: managerCookie, body: { actionText: '케이블 교체 및 레벨 확인 완료' },
  });
  assert.equal(fieldAction.response.status, 201);
  assert.equal(fieldAction.payload.data?.workflowStatus, 'field_processed');

  const completed = await call<{ workflowStatus: string }>(`/work-transfers/${transferId}/complete`, {
    method: 'POST', cookie: teamCookie, body: { comment: '현장처리 검수 완료' },
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.payload.data?.workflowStatus, 'completed');

  const hiddenCompleted = await call(`/work-transfers/${transferId}`, { cookie: managerCookie });
  assert.equal(hiddenCompleted.response.status, 404);
  const managerSummary = await call<{ completed: number }>('/work-transfers/summary', { cookie: managerCookie });
  assert.equal(managerSummary.payload.data?.completed, 0);

  const reopened = await call<{ workflowStatus: string }>(`/work-transfers/${transferId}/reopen`, {
    method: 'POST', cookie: adminCookie, body: { reason: '완료 결과 재확인 필요' },
  });
  assert.equal(reopened.response.status, 200);
  assert.equal(reopened.payload.data?.workflowStatus, 'field_processed');
  const visibleAgain = await call(`/work-transfers/${transferId}`, { cookie: managerCookie });
  assert.equal(visibleAgain.response.status, 200);

  const teamDelete = await call(`/work-transfers/${transferId}`, {
    method: 'DELETE', cookie: teamCookie, body: { reason: '권한 확인' },
  });
  assert.equal(teamDelete.response.status, 403);
  const managerDelete = await call(`/work-transfers/${transferId}`, {
    method: 'DELETE', cookie: managerCookie, body: { reason: '권한 확인' },
  });
  assert.equal(managerDelete.response.status, 403);
  const missingDeleteReason = await call(`/work-transfers/${transferId}`, {
    method: 'DELETE', cookie: adminCookie, body: {},
  });
  assert.equal(missingDeleteReason.response.status, 400);
  const deleted = await call<{ deleted: boolean }>(`/work-transfers/${transferId}`, {
    method: 'DELETE', cookie: adminCookie, body: { reason: '잘못 등록된 점검표' },
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.data?.deleted, true);
  const hiddenAfterDelete = await call(`/work-transfers/${transferId}`, { cookie: adminCookie });
  assert.equal(hiddenAfterDelete.response.status, 404);
  const deletedRow = db.prepare(`
    SELECT deleted_at, deleted_by, delete_reason FROM work_transfers WHERE id = ?
  `).get(transferId) as { deleted_at: string; deleted_by: string; delete_reason: string };
  assert.ok(deletedRow.deleted_at);
  assert.equal(deletedRow.deleted_by, 'user-5');
  assert.equal(deletedRow.delete_reason, '잘못 등록된 점검표');
  const deleteAudit = db.prepare(`
    SELECT metadata FROM audit_logs WHERE action = 'WORK_TRANSFER_DELETED' AND target_id = ?
  `).get(transferId) as { metadata: string };
  assert.equal(JSON.parse(deleteAudit.metadata).reason, '잘못 등록된 점검표');

  console.log('Work-transfer test passed: explicit fields → region RBAC → field action → completion → reopen → soft delete');
} finally {
  if (transferId) db.prepare('DELETE FROM work_transfers WHERE id = ?').run(transferId);
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-3', 'user-4', 'user-5')").run();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
