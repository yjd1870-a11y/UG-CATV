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
const call = async <T>(path: string, cookie?: string) => {
  const response = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const payload = await response.json() as Envelope<T>;
  return { response, payload };
};
const login = async (username: string) => {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: '1234' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')?.split(';')[0] || '';
};

type Analytics = {
  summary: {
    received: number; registered: number; fieldProcessed: number; completedFromReceived: number;
    completedInPeriod: number; completionRate: number; urgent: number; averageProcessingHours: number | null;
  };
  trend: Array<{ bucket: string; received: number; completedInPeriod: number }>;
  byRegion: Array<{ regionId: string; received: number }>;
  byFieldProcessor: Array<{ fieldProcessorId: string | null; fieldProcessorName: string; received: number }>;
  details: { total: number; items: Array<{ id: string }> };
};

const prefix = 'analytics-test-';
try {
  for (const [index, name] of ['평택안성', '용인', '수원', '오산화성'].entries()) {
    db.prepare(`
      INSERT INTO regions (id, region_name, sort_order, active)
      VALUES (?, ?, ?, 1) ON CONFLICT(region_name) DO UPDATE SET active = 1
    `).run(`${prefix}region-${index + 1}`, name, index + 1);
  }
  const managedSuwon = db.prepare("SELECT id FROM regions WHERE region_name = '수원'").get() as { id: string };
  const managedYongin = db.prepare("SELECT id FROM regions WHERE region_name = '용인'").get() as { id: string };
  db.prepare("UPDATE users SET region_id = ? WHERE id IN ('user-1', 'user-4')").run(managedSuwon.id);
  db.prepare("UPDATE users SET region_id = ? WHERE id = 'user-3'").run(managedYongin.id);
  const [adminCookie, teamCookie, managerCookie] = await Promise.all([login('user-5'), login('user-4'), login('user-1')]);
  const teamRegion = db.prepare('SELECT region_id AS id FROM users WHERE id = ?').get('user-4') as { id: string };
  const otherRegion = db.prepare('SELECT region_id AS id FROM users WHERE id = ?').get('user-3') as { id: string };
  assert.ok(teamRegion.id);
  assert.ok(otherRegion.id);
  assert.notEqual(teamRegion.id, otherRegion.id);

  const insert = db.prepare(`
    INSERT INTO work_transfers (
      id, title, description, priority, status, transfer_date, extra_json, region_id,
      workflow_status, is_urgent, inspection_requested_date, branch_name, customer_address,
      handover_reason, field_processed_by, field_processed_at, completed_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const add = (id: string, input: {
    regionId: string; requested: string; workflow?: string; urgent?: number; processor?: string | null;
    processedAt?: string | null; completedAt?: string | null; deletedAt?: string | null;
  }) => insert.run(
    `${prefix}${id}`, `통계 테스트 ${id}`, `통계 테스트 ${id}`, input.urgent ? 'urgent' : 'normal',
    input.workflow === 'completed' ? 'completed' : 'pending', input.requested, input.regionId,
    input.workflow || 'registered', input.urgent || 0, input.requested, 'HNS테스트지점',
    `테스트 주소 ${id}`, `테스트 사유 ${id}`, input.processor || null, input.processedAt || null,
    input.completedAt || null, input.deletedAt || null,
  );

  add('registered', { regionId: teamRegion.id, requested: '2031-01-01', urgent: 1 });
  add('field', { regionId: teamRegion.id, requested: '2031-01-31', workflow: 'field_processed', processor: 'user-1', processedAt: '2031-01-31T09:00:00.000Z' });
  add('completed-next-kst', { regionId: teamRegion.id, requested: '2031-01-15', workflow: 'completed', processor: 'user-1', processedAt: '2031-01-30T02:00:00.000Z', completedAt: '2031-01-31T15:30:00.000Z' });
  add('completed-in-period', { regionId: teamRegion.id, requested: '2030-12-31', workflow: 'completed', processor: 'user-1', processedAt: '2030-12-31T10:00:00.000Z', completedAt: '2030-12-31T15:30:00.000Z' });
  add('unassigned', { regionId: teamRegion.id, requested: '2031-01-20' });
  add('deleted', { regionId: teamRegion.id, requested: '2031-01-10', deletedAt: '2031-01-11T00:00:00.000Z' });
  add('other-region', { regionId: otherRegion.id, requested: '2031-01-12', workflow: 'completed', processor: 'user-3', processedAt: '2031-01-15T00:00:00.000Z', completedAt: '2031-01-20T00:00:00.000Z' });
  db.prepare(`INSERT INTO work_transfer_field_actions (id, transfer_id, action_text, processed_by, processed_by_name, processed_at) VALUES (?, ?, ?, ?, ?, ?)`).run(`${prefix}action-1`, `${prefix}field`, '1차 처리', 'user-1', '김현장', '2031-01-31T09:00:00.000Z');
  db.prepare(`INSERT INTO work_transfer_field_actions (id, transfer_id, action_text, processed_by, processed_by_name, processed_at) VALUES (?, ?, ?, ?, ?, ?)`).run(`${prefix}action-2`, `${prefix}field`, '추가 확인', 'user-1', '김현장', '2031-01-31T10:00:00.000Z');

  const query = '?periodType=month&month=2031-01&detailLimit=100';
  const admin = await call<Analytics>(`/work-transfers/analytics${query}`, adminCookie);
  assert.equal(admin.response.status, 200);
  assert.equal(admin.payload.data?.summary.received, 5);
  assert.equal(admin.payload.data?.summary.registered, 2);
  assert.equal(admin.payload.data?.summary.fieldProcessed, 1);
  assert.equal(admin.payload.data?.summary.completedFromReceived, 2);
  assert.equal(admin.payload.data?.summary.completedInPeriod, 2);
  assert.equal(admin.payload.data?.summary.completionRate, 40);
  assert.equal(admin.payload.data?.summary.urgent, 1);
  assert.equal(admin.payload.data?.details.total, 5);
  assert.equal(admin.payload.data?.trend.length, 31);
  assert.equal(admin.payload.data?.trend.find((row) => row.bucket === '2031-01-01')?.received, 1);
  assert.equal(admin.payload.data?.trend.find((row) => row.bucket === '2031-01-01')?.completedInPeriod, 1);
  assert.equal(admin.payload.data?.byRegion.reduce((sum, row) => sum + row.received, 0), admin.payload.data?.summary.received);

  const yearly = await call<Analytics>('/work-transfers/analytics?periodType=year&year=2031', adminCookie);
  assert.equal(yearly.payload.data?.trend.length, 12);
  const shortRange = await call<Analytics>('/work-transfers/analytics?periodType=range&from=2031-01-01&to=2031-01-02', adminCookie);
  assert.equal(shortRange.payload.data?.trend.length, 2);
  const longRange = await call<Analytics>('/work-transfers/analytics?periodType=range&from=2031-01-01&to=2031-03-15', adminCookie);
  assert.equal(longRange.payload.data?.trend.length, 3);

  const team = await call<Analytics>(`/work-transfers/analytics${query}`, teamCookie);
  assert.equal(team.response.status, 200);
  assert.equal(team.payload.data?.summary.received, 4);
  assert.equal(team.payload.data?.summary.completedFromReceived, 1);
  assert.equal(team.payload.data?.summary.completedInPeriod, 1);
  assert.equal(team.payload.data?.byRegion.length, 1);
  assert.equal(team.payload.data?.byRegion[0].regionId, teamRegion.id);
  assert.equal(team.payload.data?.byFieldProcessor.find((row) => row.fieldProcessorId === 'user-1')?.received, 2);
  assert.equal(team.payload.data?.byFieldProcessor.find((row) => row.fieldProcessorId === null)?.received, 2);

  const manager = await call(`/work-transfers/analytics${query}`, managerCookie);
  assert.equal(manager.response.status, 403);
  const managerMeta = await call('/work-transfers/analytics/meta', managerCookie);
  assert.equal(managerMeta.response.status, 403);
  const managerExport = await fetch(`${base}/work-transfers/analytics/export${query}`, { headers: { Cookie: managerCookie } });
  assert.equal(managerExport.status, 403);
  const forbiddenRegion = await call(`/work-transfers/analytics${query}&regionId=${encodeURIComponent(otherRegion.id)}`, teamCookie);
  assert.equal(forbiddenRegion.response.status, 404);

  const processor = await call<Analytics>(`/work-transfers/analytics${query}&fieldProcessorId=user-1`, teamCookie);
  assert.equal(processor.response.status, 200);
  assert.equal(processor.payload.data?.summary.received, 2);
  const unassigned = await call<Analytics>(`/work-transfers/analytics${query}&fieldProcessorId=unassigned`, teamCookie);
  assert.equal(unassigned.payload.data?.summary.received, 2);
  const listByProcessor = await call<Array<{ id: string }>>('/work-transfers?from=2031-01-01&to=2031-01-31&fieldProcessorId=user-1', teamCookie);
  assert.equal(listByProcessor.payload.data?.filter((row) => row.id.startsWith(prefix)).length, 2);

  const completedInPeriod = await call<Analytics>(`/work-transfers/analytics${query}&detailMetric=completedInPeriod`, teamCookie);
  assert.equal(completedInPeriod.payload.data?.details.total, 1);
  assert.equal(completedInPeriod.payload.data?.details.items[0].id, `${prefix}completed-in-period`);

  const exportResponse = await fetch(`${base}/work-transfers/analytics/export${query}`, { headers: { Cookie: adminCookie } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /text\/csv/);
  const csv = await exportResponse.text();
  assert.match(csv, /점검요청일/);
  assert.match(csv, /현장처리자 미지정/);
  assert.doesNotMatch(csv, /통계 테스트 deleted/);

  const invalidRange = await call('/work-transfers/analytics?periodType=range&from=2031-02-01&to=2031-01-01', adminCookie);
  assert.equal(invalidRange.response.status, 400);
  const invalidMonth = await call('/work-transfers/analytics?periodType=month&month=2031-13', adminCookie);
  assert.equal(invalidMonth.response.status, 400);

  console.log('Work-transfer analytics test passed: RBAC, KST boundaries, representative processor, de-duplication, drilldown, and CSV');
} finally {
  db.prepare('DELETE FROM work_transfer_field_actions WHERE id LIKE ?').run(`${prefix}%`);
  db.prepare('DELETE FROM work_transfers WHERE id LIKE ?').run(`${prefix}%`);
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-4', 'user-5')").run();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
