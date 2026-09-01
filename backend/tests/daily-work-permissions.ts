import assert from 'node:assert/strict';
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

type Payload<T> = { success: boolean; data?: T; message?: string; code?: string };
const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as Payload<T>;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
};

const login = async (username: string) => {
  const result = await call('/auth/login', { method: 'POST', body: { username, password: '1234' } });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
};

const dateOffset = (date: string, offset: number) => {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

const prefix = `daily-permission-${Date.now()}-`;
const today = todayInSeoul();
const previousDate = dateOffset(today, -1);
const futureDate = dateOffset(today, 1);
const regionOne = db.prepare("SELECT region_id AS id FROM users WHERE id = 'user-1'").get() as { id: string };
const regionTwo = db.prepare("SELECT region_id AS id FROM users WHERE id = 'user-3'").get() as { id: string };

db.prepare("UPDATE users SET access_role = 'public_official', region_id = ? WHERE id = 'user-2'").run(regionOne.id);
db.prepare("UPDATE users SET region_id = ? WHERE id = 'user-4'").run(regionOne.id);
db.prepare('DELETE FROM daily_work WHERE work_date IN (?, ?)').run(previousDate, today);
db.prepare("UPDATE work_transfers SET workflow_status = 'completed'").run();

const insertTransfer = db.prepare(`
  INSERT INTO work_transfers (
    id, transfer_date, status, title, description, extra_json,
    region_id, workflow_status, is_urgent, ocr_status
  ) VALUES (?, ?, 'pending', '홈 집계 테스트', '홈 집계 테스트', '{}', ?, ?, ?, 'pending')
`);
insertTransfer.run(`${prefix}registered`, today, regionOne.id, 'registered', 0);
insertTransfer.run(`${prefix}field`, today, regionOne.id, 'field_processed', 1);
insertTransfer.run(`${prefix}completed`, today, regionOne.id, 'completed', 0);
insertTransfer.run(`${prefix}other`, today, regionTwo.id, 'registered', 0);

const createdIds: string[] = [];
try {
  const [adminCookie, publicCookie, teamCookie, managerCookie] = await Promise.all([
    login('user-5'), login('user-2'), login('user-4'), login('user-1'),
  ]);

  const adminPast = await call<{ id: string }>('/daily-work', {
    method: 'POST', cookie: adminCookie,
    body: { date: '2020-01-10', userId: 'user-3', counts: { WORK01: 1 } },
  });
  assert.equal(adminPast.response.status, 201);
  createdIds.push(adminPast.payload.data?.id || '');

  const publicPast = await call<{ id: string }>('/daily-work', {
    method: 'POST', cookie: publicCookie,
    body: { date: '2020-01-11', userId: 'user-3', counts: { WORK01: 2 } },
  });
  assert.equal(publicPast.response.status, 201);
  const publicPastId = publicPast.payload.data?.id || '';
  createdIds.push(publicPastId);

  const publicPastDetail = await call<{ updatedAt: string }>('/daily-work/record?date=2020-01-11&userId=user-3', { cookie: publicCookie });
  const publicUpdate = await call<{ total: number }>(`/daily-work/${publicPastId}`, {
    method: 'PUT', cookie: publicCookie,
    body: { date: '2020-01-11', counts: { WORK01: 5 }, updatedAt: publicPastDetail.payload.data?.updatedAt },
  });
  assert.equal(publicUpdate.response.status, 200);
  assert.equal(publicUpdate.payload.data?.total, 5);

  const teamPast = await call<{ id: string }>('/daily-work', {
    method: 'POST', cookie: teamCookie,
    body: { date: '2020-01-12', userId: 'user-1', counts: { WORK01: 3 } },
  });
  assert.equal(teamPast.response.status, 201);
  createdIds.push(teamPast.payload.data?.id || '');

  const teamOtherRegion = await call('/daily-work', {
    method: 'POST', cookie: teamCookie,
    body: { date: '2020-01-13', userId: 'user-3', counts: { WORK01: 1 } },
  });
  assert.equal(teamOtherRegion.response.status, 404);

  const managerPast = await call('/daily-work', {
    method: 'POST', cookie: managerCookie,
    body: { date: '2020-01-14', counts: { WORK01: 1 } },
  });
  assert.equal(managerPast.response.status, 403);
  assert.equal(managerPast.payload.code, 'PAST_WORK_LOCKED');

  const managerDelegated = await call('/daily-work', {
    method: 'POST', cookie: managerCookie,
    body: { date: today, userId: 'user-3', counts: { WORK01: 1 } },
  });
  assert.equal(managerDelegated.response.status, 403);

  const futureBlocked = await call('/daily-work', {
    method: 'POST', cookie: adminCookie,
    body: { date: futureDate, userId: 'user-3', counts: { WORK01: 1 } },
  });
  assert.equal(futureBlocked.response.status, 400);
  assert.equal(futureBlocked.payload.code, 'FUTURE_WORK_DATE');

  const teamMeta = await call<{ users: Array<{ id: string }>; regions: Array<{ id: string }> }>('/daily-work/meta', { cookie: teamCookie });
  assert.deepEqual(new Set(teamMeta.payload.data?.users.map((user) => user.id)), new Set(['user-1', 'user-2', 'user-4']));
  assert.deepEqual(teamMeta.payload.data?.regions.map((region) => region.id), [regionOne.id]);

  const publicMeta = await call<{ users: Array<{ id: string }> }>('/daily-work/meta', { cookie: publicCookie });
  assert.ok(publicMeta.payload.data?.users.some((user) => user.id === 'user-3'));

  const publicCategories = await call('/admin/daily-work/categories', { cookie: publicCookie });
  assert.equal(publicCategories.response.status, 403);

  const summaryBefore = await call<{ todayMissingCount: number; previousMissingCount: number; incompleteTransferCount: number }>('/home/summary', { cookie: adminCookie });
  assert.equal(summaryBefore.payload.data?.todayMissingCount, 2);
  assert.equal(summaryBefore.payload.data?.previousMissingCount, 2);
  assert.equal(summaryBefore.payload.data?.incompleteTransferCount, 3);

  const teamSummaryBefore = await call<{ todayMissingCount: number; incompleteTransferCount: number }>('/home/summary', { cookie: teamCookie });
  assert.equal(teamSummaryBefore.payload.data?.todayMissingCount, 1);
  assert.equal(teamSummaryBefore.payload.data?.incompleteTransferCount, 2);

  const managerSummaryBefore = await call<{ todayMissingCount: number; incompleteTransferCount: number }>('/home/summary', { cookie: managerCookie });
  assert.deepEqual(managerSummaryBefore.payload.data, teamSummaryBefore.payload.data);

  const zeroCountTeam = await call<{ id: string }>('/daily-work', {
    method: 'POST', cookie: teamCookie,
    body: { date: today, userId: 'user-1', counts: {} },
  });
  assert.equal(zeroCountTeam.response.status, 201);
  createdIds.push(zeroCountTeam.payload.data?.id || '');

  const duplicateTeam = await call('/daily-work', {
    method: 'POST', cookie: teamCookie,
    body: { date: today, userId: 'user-1', counts: { WORK01: 1 } },
  });
  assert.equal(duplicateTeam.response.status, 409);
  assert.equal(duplicateTeam.payload.code, 'DAILY_WORK_EXISTS');

  const teamSummaryAfter = await call<{ todayMissingCount: number }>('/home/summary', { cookie: teamCookie });
  assert.equal(teamSummaryAfter.payload.data?.todayMissingCount, 0);

  const otherToday = await call<{ id: string }>('/daily-work', {
    method: 'POST', cookie: publicCookie,
    body: { date: today, userId: 'user-3', counts: { WORK01: 4 } },
  });
  assert.equal(otherToday.response.status, 201);
  const otherTodayId = otherToday.payload.data?.id || '';
  createdIds.push(otherTodayId);

  const allEntered = await call<{ todayMissingCount: number }>('/home/summary', { cookie: adminCookie });
  assert.equal(allEntered.payload.data?.todayMissingCount, 0);

  const teamDelete = await call(`/daily-work/${otherTodayId}`, {
    method: 'DELETE', cookie: teamCookie, body: { reason: '권한 테스트' },
  });
  assert.equal(teamDelete.response.status, 403);

  const publicDelete = await call<{ hardDeleted: boolean }>(`/daily-work/${otherTodayId}`, {
    method: 'DELETE', cookie: publicCookie, body: { reason: '통합 테스트 삭제' },
  });
  assert.equal(publicDelete.response.status, 200);
  assert.equal(publicDelete.payload.data?.hardDeleted, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_work WHERE id = ?').get(otherTodayId)?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_work_items WHERE daily_work_id = ?').get(otherTodayId)?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_work_history WHERE daily_work_id = ?').get(otherTodayId)?.count, 0);
  const audit = db.prepare("SELECT metadata FROM audit_logs WHERE action = 'DAILY_WORK_DELETE' AND target_id = ? ORDER BY created_at DESC LIMIT 1").get(otherTodayId) as { metadata: string } | undefined;
  assert.ok(audit);
  assert.equal(JSON.parse(audit.metadata).reason, '통합 테스트 삭제');

  const missingAfterDelete = await call<{ todayMissingCount: number }>('/home/summary', { cookie: adminCookie });
  assert.equal(missingAfterDelete.payload.data?.todayMissingCount, 1);

  const publicGlobal = await call<{ rows: Array<{ userId: string }> }>(`/admin/daily-work/person?from=2020-01-10&to=2020-01-12`, { cookie: publicCookie });
  assert.ok(publicGlobal.payload.data?.rows.some((row) => row.userId === 'user-3'));

  const teamScoped = await call<{ rows: Array<{ userId: string }> }>(`/admin/daily-work/person?from=2020-01-10&to=2020-01-12`, { cookie: teamCookie });
  assert.ok(teamScoped.payload.data?.rows.every((row) => row.userId !== 'user-3'));

  console.log('daily work permissions and home summary tests passed');
} finally {
  db.prepare(`DELETE FROM daily_work WHERE id IN (${createdIds.filter(Boolean).map(() => '?').join(',') || "''"})`).run(...createdIds.filter(Boolean));
  db.prepare('DELETE FROM work_transfers WHERE id LIKE ?').run(`${prefix}%`);
  db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-1', 'user-2', 'user-4', 'user-5')").run();
  server.close();
}
