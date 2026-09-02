import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { todayInSeoul } from '../daily-work-service';

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
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
};

const login = async (username: string, password = '1234') => {
  const result = await call<{ role: string }>('/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result;
};

const suffix = Date.now().toString().slice(-8);
const username = `guest_${suffix}`;
let guestId = '';
let guestTransferId = '';

try {
  const admin = await login('user-5');
  const managerRegion = db.prepare(`
    SELECT r.region_name AS name
      FROM users u JOIN regions r ON r.id = u.region_id
     WHERE u.id = 'user-1'
  `).get() as { name: string };

  const baseline = await call<{ todayMissingCount: number }>('/home/summary', { cookie: admin.cookie });
  const created = await call<{ id: string }>('/admin/users', {
    method: 'POST', cookie: admin.cookie,
    body: { username, zone: managerRegion.name, name: '게스트 권한 테스트', role: 'manager', password: 'Guest123!' },
  });
  assert.equal(created.response.status, 201);
  guestId = created.payload.data?.id || '';

  const managerAdded = await call<{ todayMissingCount: number }>('/home/summary', { cookie: admin.cookie });
  assert.equal(managerAdded.payload.data?.todayMissingCount, (baseline.payload.data?.todayMissingCount || 0) + 1);

  const changed = await call<{ role: string }>(`/admin/users/${guestId}/role`, {
    method: 'PUT', cookie: admin.cookie, body: { role: 'guest' },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.payload.data?.role, 'guest');

  await initializeDatabase();
  const stored = db.prepare('SELECT role, access_role AS accessRole FROM users WHERE id = ?').get(guestId) as { role: string; accessRole: string };
  assert.equal(stored.role, 'worker');
  assert.equal(stored.accessRole, 'guest');

  const summaryAfter = await call<{ todayMissingCount: number }>('/home/summary', { cookie: admin.cookie });
  assert.equal(summaryAfter.payload.data?.todayMissingCount, baseline.payload.data?.todayMissingCount);

  const guest = await login(username, 'Guest123!');
  assert.equal(guest.payload.data?.role, 'guest');
  const me = await call<{ role: string }>('/auth/me', { cookie: guest.cookie });
  assert.equal(me.payload.data?.role, 'guest');

  const guestMeta = await call<{ users: unknown[] }>('/daily-work/meta', { cookie: guest.cookie });
  assert.equal(guestMeta.response.status, 200);
  assert.deepEqual(guestMeta.payload.data?.users, []);

  const adminMeta = await call<{ users: Array<{ id: string }> }>('/daily-work/meta', { cookie: admin.cookie });
  assert.equal(adminMeta.payload.data?.users.some((user) => user.id === guestId), false);

  for (const mutation of [
    call('/daily-work', { method: 'POST', cookie: guest.cookie, body: { date: '2026-09-02', counts: { WORK01: 1 } } }),
    call('/work-transfers', { method: 'POST', cookie: guest.cookie, body: { regionId: 'blocked' } }),
    call('/material-usage', { method: 'POST', cookie: guest.cookie, body: { materialName: 'blocked' } }),
  ]) {
    const result = await mutation;
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, 'GUEST_READ_ONLY');
  }

  const [manager, guestTransfers] = await Promise.all([
    login('user-1'),
    call<Array<{ id: string }>>('/work-transfers', { cookie: guest.cookie }),
  ]);
  const managerTransfers = await call<Array<{ id: string }>>('/work-transfers', { cookie: manager.cookie });
  assert.deepEqual(guestTransfers.payload.data?.map((item) => item.id), managerTransfers.payload.data?.map((item) => item.id));

  const today = todayInSeoul();
  const month = today.slice(0, 7);
  const analyticsBefore = await call<{ summary: { received: number } }>(
    `/work-transfers/analytics?periodType=month&month=${month}`, { cookie: admin.cookie },
  );
  guestTransferId = `guest-transfer-${suffix}`;
  const guestRegion = db.prepare('SELECT region_id AS regionId FROM users WHERE id = ?').get(guestId) as { regionId: string };
  db.prepare(`
    INSERT INTO work_transfers (
      id, transfer_date, status, title, description, extra_json, region_id,
      workflow_status, field_processed_by, field_processed_at, is_urgent, ocr_status
    ) VALUES (?, ?, 'transferred', '게스트 처리자 제외 테스트', '', '{}', ?,
      'field_processed', ?, CURRENT_TIMESTAMP, 0, 'pending')
  `).run(guestTransferId, today, guestRegion.regionId, guestId);
  const analyticsAfter = await call<{
    summary: { received: number };
    byFieldProcessor: Array<{ fieldProcessorId: string | null }>;
  }>(`/work-transfers/analytics?periodType=month&month=${month}`, { cookie: admin.cookie });
  assert.equal(analyticsAfter.payload.data?.summary.received, (analyticsBefore.payload.data?.summary.received || 0) + 1);
  assert.equal(analyticsAfter.payload.data?.byFieldProcessor.some((row) => row.fieldProcessorId === guestId), false);

  const guestProcessorFilter = await call(
    `/work-transfers/analytics?periodType=month&month=${month}&fieldProcessorId=${guestId}`,
    { cookie: admin.cookie },
  );
  assert.equal(guestProcessorFilter.response.status, 404);

  const dashboardSource = fs.readFileSync(new URL('../../src/components/home/HomeDashboard.tsx', import.meta.url), 'utf8');
  assert.equal((dashboardSource.match(/id="home-summary-/g) || []).length, 4);
  assert.match(dashboardSource, />일일업무</);
  assert.match(dashboardSource, />전일 미입력</);
  assert.match(dashboardSource, />금일 미입력</);
  assert.match(dashboardSource, />업무이관</);
  assert.match(dashboardSource, />미처리 이관</);

  console.log('guest permissions, counters, and home dashboard tests passed');
} finally {
  if (guestId) {
    if (guestTransferId) db.prepare('DELETE FROM work_transfers WHERE id = ?').run(guestTransferId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(guestId);
    db.prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(guestId);
  }
  server.close();
}
