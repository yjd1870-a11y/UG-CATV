import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { todayInSeoul } from '../daily-work-service';
import type { CatvManpowerStatus } from '../../src/types';

await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start.');
const base = `http://127.0.0.1:${address.port}/api`;

type Result<T> = { response: Response; payload: { success: boolean; data?: T; message?: string; code?: string }; cookie?: string };
const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Result<T>> => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json() as Result<T>['payload'];
  const setCookie = response.headers.get('set-cookie');
  return { response, payload, cookie: setCookie?.split(';')[0] };
};

const suffix = Date.now().toString().slice(-8);
const username = `test_${suffix}`;
let testUserId = '';
let usageId = '';
let dailyId = '';
let transferId = '';
let managedUserId = '';
let noticeId = '';
let assetId = '';
let archivedAssetId = '';
let floorPlanAssetId = '';
const additionalFloorPlanAssetIds: string[] = [];
const uploadHistoryIds: string[] = [];
const auditStart = (db.prepare('SELECT CURRENT_TIMESTAMP AS value').get() as { value: string }).value;
const manpowerBefore = db.prepare('SELECT payload_json, version, updated_at, updated_by FROM catv_manpower_status WHERE id = 1').get() as {
  payload_json: string; version: number; updated_at: string; updated_by: string | null;
} | undefined;

try {
  const health = await call<{ status: string }>('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.data?.status, 'ok');

  const weakSignup = await call('/auth/signup', {
    method: 'POST',
    body: { username: `weak_${suffix}`, password: 'Password1', name: '약한암호', department: '전송망팀' },
  });
  assert.equal(weakSignup.response.status, 400);
  assert.equal(weakSignup.payload.code, 'VALIDATION_ERROR');

  const signup = await call<{ id: string }>('/auth/signup', {
    method: 'POST',
    body: { username, password: 'Testpass123!', name: '통합테스트', employeeNumber: `T-${suffix}`, department: '전송망1팀', phone: '010-0000-0000' },
  });
  assert.equal(signup.response.status, 201);
  testUserId = signup.payload.data?.id || '';

  const pendingLogin = await call('/auth/login', { method: 'POST', body: { username, password: 'Testpass123!' } });
  assert.equal(pendingLogin.response.status, 403);
  assert.equal(pendingLogin.payload.message, '관리자 승인 대기 중인 계정입니다.');

  const adminLogin = await call('/auth/login', { method: 'POST', body: { username: 'user-5', password: '1234' } });
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.cookie);
  const pendingUsers = await call<Array<{ id: string }>>('/admin/users?status=pending', { cookie: adminLogin.cookie });
  assert.ok(pendingUsers.payload.data?.some((user) => user.id === testUserId));
  const approve = await call(`/admin/users/${testUserId}/approve`, { method: 'PUT', cookie: adminLogin.cookie });
  assert.equal(approve.response.status, 200);

  const workerLogin = await call('/auth/login', { method: 'POST', body: { username, password: 'Testpass123!' } });
  assert.equal(workerLogin.response.status, 200);
  assert.ok(workerLogin.cookie);

  const forbiddenAdminDb = await call('/admin/db/status', { cookie: workerLogin.cookie });
  assert.equal(forbiddenAdminDb.response.status, 403);

  const managedUser = await call<{ id: string }>('/admin/users', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { username: `managed_${suffix}`, zone: '테스트지역', name: '관리계정', role: 'admin', password: 'Abc1234!' },
  });
  assert.equal(managedUser.response.status, 201);
  managedUserId = managedUser.payload.data?.id || '';
  const resetManagedPassword = await call(`/admin/users/${managedUserId}/password`, {
    method: 'PUT',
    cookie: adminLogin.cookie,
    body: { password: 'Def5678!' },
  });
  assert.equal(resetManagedPassword.response.status, 200);
  const disableManaged = await call(`/admin/users/${managedUserId}/disable`, { method: 'PUT', cookie: adminLogin.cookie });
  assert.equal(disableManaged.response.status, 200);
  const enableManaged = await call(`/admin/users/${managedUserId}/enable`, { method: 'PUT', cookie: adminLogin.cookie });
  assert.equal(enableManaged.response.status, 200);
  const changeManagedRole = await call<{ role: string }>(`/admin/users/${managedUserId}/role`, {
    method: 'PUT', cookie: adminLogin.cookie, body: { role: 'public_official' },
  });
  assert.equal(changeManagedRole.response.status, 200);
  assert.equal(changeManagedRole.payload.data?.role, 'public_official');
  const deleteManaged = await call(`/admin/users/${managedUserId}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(deleteManaged.response.status, 200);
  const recreatedManaged = await call<{ id: string }>('/admin/users', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { username: `managed_${suffix}`, zone: '재생성지역', name: '재생성계정', role: 'public_official', password: 'Recreate9!' },
  });
  assert.equal(recreatedManaged.response.status, 201);
  assert.equal(recreatedManaged.payload.data?.id, managedUserId);
  const recreatedLogin = await call('/auth/login', { method: 'POST', body: { username: `managed_${suffix}`, password: 'Recreate9!' } });
  assert.equal(recreatedLogin.response.status, 200);

  const manpower = await call<{ status: CatvManpowerStatus }>('/manpower', { cookie: workerLogin.cookie });
  assert.equal(manpower.response.status, 200);
  const changedManpower = structuredClone(manpower.payload.data?.status);
  assert.ok(changedManpower);
  changedManpower.regions[0].headcount += 1;
  changedManpower.lastUpdated = '2099.12.31 23:59';
  const forbiddenManpowerUpdate = await call('/manpower', { method: 'PUT', cookie: workerLogin.cookie, body: changedManpower });
  assert.equal(forbiddenManpowerUpdate.response.status, 403);
  const updatedManpower = await call<{ status: { lastUpdated: string } }>('/manpower', { method: 'PUT', cookie: adminLogin.cookie, body: changedManpower });
  assert.equal(updatedManpower.response.status, 200);
  assert.equal(updatedManpower.payload.data?.status.lastUpdated, '2099.12.31 23:59');
  const synchronizedManpower = await call<{ status: { lastUpdated: string } }>('/manpower', { cookie: workerLogin.cookie });
  assert.equal(synchronizedManpower.payload.data?.status.lastUpdated, '2099.12.31 23:59');

  const dbStatus = await call<{ counts: { cells: number } }>('/admin/db/status', { cookie: adminLogin.cookie });
  assert.equal(dbStatus.response.status, 200);
  assert.ok((dbStatus.payload.data?.counts.cells || 0) > 0);

  type TestAdminCell = Record<string, unknown> & { id: string; keyNumber: string; cellName: string };
  const adminCellPageBeforeUpload = await call<{ items: TestAdminCell[]; pagination: { total: number } }>('/admin/db/cells?page=1&limit=10', {
    cookie: adminLogin.cookie,
  });
  assert.equal(adminCellPageBeforeUpload.response.status, 200);
  const existingCell = adminCellPageBeforeUpload.payload.data?.items[0];
  const cellCountBeforeUpload = adminCellPageBeforeUpload.payload.data?.pagination.total || 0;
  assert.ok(existingCell);
  assert.ok(cellCountBeforeUpload > 1);

  const updatedCellName = `${existingCell.cellName}-키번호수정`;
  const validatedCells = await call<{
    valid: boolean; validationId: string; newCount: number; updatedCount: number; deletedCount: number;
  }>('/admin/db/validate', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      fileName: 'CELL_TEST.xlsx',
      fileSize: 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      records: [{
        keyNumber: existingCell.keyNumber, cellName: updatedCellName,
        stationName: '테스트_오산국사', stationAddress: '오산시 테스트로 1',
        otxNode: '테스트향 288C', otxLineNumber: '101', orxNode: '테스트향 288C', orxLineNumber: '102',
        spareNode: '예비향 288C', spareLineNumber: '103', otxRack: '401', otxShelf: '1', otxPort: '1',
        otxModel: 'ARRIS', orxRack: '401', orxShelf: '1', orxPort: '2', orxModel: 'ARRIS',
        onuLocation: '오산시 테스트동 1', onuPhoto: '37', onuPhotoList: '37', onuManufacturer: '아리스',
        onuModel: 'R-ONU', onuDivision: '1*1', onuCellConfig: '아파트',
        upsLocation: '오산시 테스트동 1', upsPhoto: '37', upsPhotoList: '37',
        upsManufacturer: 'AP시스템', upsModel: 'APU-990N', notes: '키번호 기준 수정 테스트',
      }],
    },
  });
  assert.equal(validatedCells.response.status, 200);
  assert.equal(validatedCells.payload.data?.valid, true);
  assert.equal(validatedCells.payload.data?.newCount, 0);
  assert.equal(validatedCells.payload.data?.updatedCount, 1);
  assert.equal(validatedCells.payload.data?.deletedCount, 0);

  const uploadedCells = await call<{ uploaded: true }>('/admin/db/upload', {
    method: 'POST', cookie: adminLogin.cookie, body: { validationId: validatedCells.payload.data?.validationId },
  });
  assert.equal(uploadedCells.response.status, 200);

  const persistedCell = db.prepare(`
    SELECT id, cell_name AS cellName FROM cells WHERE lower(cell_code) = lower(?) AND deleted_at IS NULL
  `).get(existingCell.keyNumber) as { id: string; cellName: string } | undefined;
  assert.equal(persistedCell?.id, existingCell.id);
  assert.equal(persistedCell?.cellName, updatedCellName);
  const cellCountAfterUpload = Number((db.prepare(
    'SELECT COUNT(*) AS count FROM cells WHERE deleted_at IS NULL'
  ).get() as { count: number }).count);
  assert.equal(cellCountAfterUpload, cellCountBeforeUpload);
  const catvFixtureName = updatedCellName;

  const savedAsset = await call<{ id: string }>('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      dbType: 'b2c', stationName: '테스트국사', fileName: 'B2C_TEST.xlsx', fileSize: 1024,
      records: [{ serviceName: '통합테스트 전용선', b2cName: 'TEST-B2C', node: 'TEST-NODE', line: 'T-101', memo: '평택시 테스트동', searchValues: ['통합테스트 전용선', '평택시 테스트동'] }],
    },
  });
  assert.equal(savedAsset.response.status, 201);
  assetId = savedAsset.payload.data?.id || '';
  const shortB2cSearch = await call<{ items: Array<{ serviceName: string }> }>('/b2c/search?q=평택시', { cookie: workerLogin.cookie });
  assert.equal(shortB2cSearch.response.status, 200);
  assert.equal(shortB2cSearch.payload.data?.items[0]?.serviceName, '통합테스트 전용선');
  const b2cSearch = await call<{ items: Array<{ serviceName: string }> }>(`/b2c/search?q=${encodeURIComponent('평택시 테스트')}`, { cookie: workerLogin.cookie });
  assert.equal(b2cSearch.response.status, 200);
  assert.equal(b2cSearch.payload.data?.items[0]?.serviceName, '통합테스트 전용선');

  archivedAssetId = assetId;
  const replacedAsset = await call<{ id: string }>('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      dbType: 'b2c', stationName: '테스트 국사', fileName: 'B2C_TEST_UPDATED.xlsx', fileSize: 2048,
      records: [{ serviceName: '교체된 통합테스트 회선', b2cName: 'TEST-B2C-NEW', node: 'TEST-NODE-NEW', core: '208', memo: '용인시 변경동', searchValues: ['교체된 통합테스트 회선', '용인시 변경동'] }],
    },
  });
  assert.equal(replacedAsset.response.status, 201);
  assetId = replacedAsset.payload.data?.id || '';
  const staleB2cSearch = await call<{ items: unknown[] }>(`/b2c/search?q=${encodeURIComponent('평택시 테스트')}`, { cookie: workerLogin.cookie });
  assert.equal(staleB2cSearch.payload.data?.items.length, 0);
  const replacedB2cSearch = await call<{ items: Array<{ serviceName: string; core: string }> }>(`/b2c/search?q=${encodeURIComponent('용인시 변경')}`, { cookie: workerLogin.cookie });
  assert.equal(replacedB2cSearch.payload.data?.items[0]?.serviceName, '교체된 통합테스트 회선');
  assert.equal(replacedB2cSearch.payload.data?.items[0]?.core, '208');

  const floorAsset = await call<{ id: string }>('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      dbType: 'floor_plan', stationName: '오산국사', fileName: 'OSAN_PLAN.png', fileSize: 68, mimeType: 'image/png',
      records: [{ imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
      coordinates: { 'OSAN-NODE': { type: 'node', xRatio: 0.42, yRatio: 0.61 }, 'Rack 3': { type: 'rack', xRatio: 0.25, yRatio: 0.35 } },
    },
  });
  assert.equal(floorAsset.response.status, 201);
  floorPlanAssetId = floorAsset.payload.data?.id || '';
  const updatedFloorAsset = await call(`/admin/db/assets/${floorPlanAssetId}`, {
    method: 'PUT',
    cookie: adminLogin.cookie,
    body: {
      stationName: '오산국사',
      records: [],
      coordinates: { 'Rack 7': { type: 'rack', xRatio: 0.73, yRatio: 0.27 } },
    },
  });
  assert.equal(updatedFloorAsset.response.status, 200);
  const floorAssets = await call<Array<{ id: string; imageUrl: string | null }>>('/admin/db/assets?type=floor_plan', { cookie: adminLogin.cookie });
  const updatedFloorPlan = floorAssets.payload.data?.find((asset) => asset.id === floorPlanAssetId);
  assert.ok(updatedFloorPlan?.imageUrl);
  const floorImage = await fetch(`${base}${updatedFloorPlan.imageUrl?.replace(/^\/api/, '')}`, {
    headers: { Cookie: workerLogin.cookie || '' },
  });
  assert.equal(floorImage.status, 200);
  assert.equal(floorImage.headers.get('content-type'), 'image/png');
  const floorPlan = await call<{ floorPlan: { stationName: string }; target: { label: string } | null }>(
    '/floor-plans/search?station=기남_오산국사&target=OSAN-NODE&type=node', { cookie: workerLogin.cookie }
  );
  assert.equal(floorPlan.response.status, 200);
  assert.equal(floorPlan.payload.data?.floorPlan.stationName, '오산국사');
  assert.equal(floorPlan.payload.data?.target, null);
  const rackPlan = await call<{ target: { label: string } | null }>(
    '/floor-plans/search?station=오산국사&target=7&type=rack', { cookie: workerLogin.cookie }
  );
  assert.equal(rackPlan.payload.data?.target?.label, 'Rack 7');
  const floorImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  for (const [index, rack] of ['Rack 22', 'Rack 33'].entries()) {
    const extraPlan = await call<{ id: string }>('/admin/db/assets', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: {
        dbType: 'floor_plan', stationName: '오산국사', fileName: `OSAN_PLAN_${index + 2}.png`, fileSize: 68, mimeType: 'image/png',
        records: [{ imageDataUrl: floorImageDataUrl }],
        coordinates: { [rack]: { type: 'rack', xRatio: 0.2 + index * 0.1, yRatio: 0.4 + index * 0.1 } },
      },
    });
    assert.equal(extraPlan.response.status, 201);
    additionalFloorPlanAssetIds.push(extraPlan.payload.data?.id || '');
  }
  const multiPlanAssets = await call<Array<{ id: string; planOrder: number }>>('/admin/db/assets?type=floor_plan', { cookie: adminLogin.cookie });
  assert.deepEqual(
    multiPlanAssets.payload.data?.filter((asset) => [floorPlanAssetId, ...additionalFloorPlanAssetIds].includes(asset.id)).map((asset) => asset.planOrder),
    [1, 2, 3],
  );
  const secondPlanSearch = await call<{ floorPlan: { planOrder: number }; target: { label: string } | null; plans: unknown[] }>(
    '/floor-plans/search?station=오산국사&target=22&type=rack', { cookie: workerLogin.cookie }
  );
  assert.equal(secondPlanSearch.payload.data?.floorPlan.planOrder, 2);
  assert.equal(secondPlanSearch.payload.data?.target?.label, 'Rack 22');
  assert.equal(secondPlanSearch.payload.data?.plans.length, 3);
  const fourthPlan = await call('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      dbType: 'floor_plan', stationName: '오산국사', fileName: 'OSAN_PLAN_4.png', fileSize: 68, mimeType: 'image/png',
      records: [{ imageDataUrl: floorImageDataUrl }], coordinates: {},
    },
  });
  assert.equal(fourthPlan.response.status, 409);
  assert.equal(fourthPlan.payload.code, 'FLOOR_PLAN_LIMIT_EXCEEDED');
  const removedSecondPlan = await call(`/admin/db/assets/${additionalFloorPlanAssetIds[0]}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(removedSecondPlan.response.status, 200);
  additionalFloorPlanAssetIds.shift();
  const reusedPlan = await call<{ id: string }>('/admin/db/assets', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      dbType: 'floor_plan', stationName: '오산국사', fileName: 'OSAN_PLAN_REUSED.png', fileSize: 68, mimeType: 'image/png',
      records: [{ imageDataUrl: floorImageDataUrl }], coordinates: { 'Rack 24': { type: 'rack', xRatio: 0.5, yRatio: 0.5 } },
    },
  });
  assert.equal(reusedPlan.response.status, 201);
  additionalFloorPlanAssetIds.push(reusedPlan.payload.data?.id || '');
  const reusedAsset = (await call<Array<{ id: string; planOrder: number }>>('/admin/db/assets?type=floor_plan', { cookie: adminLogin.cookie }))
    .payload.data?.find((asset) => asset.id === reusedPlan.payload.data?.id);
  assert.equal(reusedAsset?.planOrder, 2);
  const missingCoordinate = await call<{ target: null }>(
    '/floor-plans/search?station=오산국사&target=UNKNOWN&type=node', { cookie: workerLogin.cookie }
  );
  assert.equal(missingCoordinate.response.status, 200);
  assert.equal(missingCoordinate.payload.data?.target, null);
  const missingPlan = await call('/floor-plans/search?station=없는국사&target=NODE&type=node', { cookie: workerLogin.cookie });
  assert.equal(missingPlan.response.status, 404);
  const deletedFloorAsset = await call(`/admin/db/assets/${floorPlanAssetId}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(deletedFloorAsset.response.status, 200);
  for (const id of additionalFloorPlanAssetIds) {
    const deleted = await call(`/admin/db/assets/${id}`, { method: 'DELETE', cookie: adminLogin.cookie });
    assert.equal(deleted.response.status, 200);
  }
  const history = await call<Array<{ id: string }>>('/admin/db/history', { cookie: adminLogin.cookie });
  assert.equal(history.response.status, 200);
  for (const entry of history.payload.data || []) uploadHistoryIds.push(entry.id);
  const deletedAsset = await call(`/admin/db/assets/${assetId}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(deletedAsset.response.status, 200);

  const search = await call<{ items: Array<{ id: string; cellName: string }> }>('/cells/search?limit=1', { cookie: workerLogin.cookie });
  assert.ok(search.payload.data?.items[0]?.cellName);
  const cellId = search.payload.data?.items[0]?.id || '';
  const legacyCellName = search.payload.data?.items[0]?.cellName || '';
  const detail = await call<{ transmissionLines: unknown[] }>(`/cells/${cellId}`, { cookie: workerLogin.cookie });
  assert.equal(detail.response.status, 200);
  assert.ok(Array.isArray(detail.payload.data?.transmissionLines));
  const catvSearch = await call<{ items: Array<{ id: string; cellName: string }> }>(`/cells/search?q=${encodeURIComponent(catvFixtureName)}`, { cookie: workerLogin.cookie });
  assert.equal(catvSearch.response.status, 200);
  const catvCellId = catvSearch.payload.data?.items[0]?.id || '';
  const catvDetail = await call<{ cellName: string }>(`/cells/${catvCellId}/transmission`, { cookie: workerLogin.cookie });
  assert.equal(catvDetail.payload.data?.cellName, catvFixtureName);

  const forbiddenTransfer = await call('/work-transfers', {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: { cellName: legacyCellName, transferReason: '권한 테스트', requestDetails: '작업자 등록 차단' },
  });
  assert.equal(forbiddenTransfer.response.status, 403);

  const today = todayInSeoul();
  const daily = await call<{ id: string; total: number }>('/daily-work', {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: {
      date: today,
      counts: {
        WORK01: 1, WORK02: 2, WORK03: 3, WORK04: 4, WORK05: 5,
        WORK06: 6, WORK07: 7, WORK08: 8, WORK09: 9, WORK10: 10,
      },
      memo: 'API 통합 테스트',
    },
  });
  assert.equal(daily.response.status, 201);
  assert.equal(daily.payload.data?.total, 55);
  dailyId = daily.payload.data?.id || '';

  const pastBlocked = await call('/daily-work', {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: { date: '2020-01-01', counts: { WORK01: 1 } },
  });
  assert.equal(pastBlocked.response.status, 403);
  assert.equal(pastBlocked.payload.code, 'PAST_WORK_LOCKED');

  const adminPerson = await call<{ grandTotal: number; rows: Array<{ id: string }> }>(`/admin/daily-work/person?from=${today}&to=${today}&userId=${testUserId}`, {
    cookie: adminLogin.cookie,
  });
  assert.equal(adminPerson.response.status, 200);
  assert.equal(adminPerson.payload.data?.grandTotal, 55);
  assert.equal(adminPerson.payload.data?.rows[0]?.id, dailyId);

  const dailyDetail = await call<{ updatedAt: string; counts: Record<string, number> }>(`/admin/daily-work/detail/${dailyId}`, {
    cookie: adminLogin.cookie,
  });
  const adminPastUpdate = await call<{ workDate: string; total: number }>(`/daily-work/${dailyId}`, {
    method: 'PUT',
    cookie: adminLogin.cookie,
    body: {
      date: '2020-01-02',
      counts: dailyDetail.payload.data?.counts,
      updatedAt: dailyDetail.payload.data?.updatedAt,
      memo: '관리자 과거 데이터 수정 테스트',
    },
  });
  assert.equal(adminPastUpdate.response.status, 200);
  assert.equal(adminPastUpdate.payload.data?.workDate, '2020-01-02');
  assert.equal(adminPastUpdate.payload.data?.total, 55);

  const workerPastUpdate = await call(`/daily-work/${dailyId}`, {
    method: 'PUT',
    cookie: workerLogin.cookie,
    body: { date: '2020-01-02', counts: dailyDetail.payload.data?.counts },
  });
  assert.equal(workerPastUpdate.response.status, 403);

  const forbiddenNotice = await call('/notices', {
    method: 'POST', cookie: workerLogin.cookie, body: { title: '권한 테스트', content: '일반 권한 등록 차단' },
  });
  assert.equal(forbiddenNotice.response.status, 403);

  const managerLoginForNotice = await call('/auth/login', { method: 'POST', body: { username: 'user-4', password: '1234' } });
  const createdNotice = await call<{ id: string; title: string }>('/notices', {
    method: 'POST', cookie: managerLoginForNotice.cookie, body: { title: '통합 테스트 전달사항', content: '팀장 추가 권한 확인' },
  });
  assert.equal(createdNotice.response.status, 201);
  noticeId = createdNotice.payload.data?.id || '';
  const updatedNotice = await call<{ content: string }>(`/notices/${noticeId}`, {
    method: 'PUT', cookie: managerLoginForNotice.cookie, body: { title: '통합 테스트 전달사항', content: '팀장 수정 권한 확인', sortOrder: 99 },
  });
  assert.equal(updatedNotice.response.status, 200);
  assert.equal(updatedNotice.payload.data?.content, '팀장 수정 권한 확인');
  const deletedNotice = await call(`/notices/${noticeId}`, { method: 'DELETE', cookie: managerLoginForNotice.cookie });
  assert.equal(deletedNotice.response.status, 200);
  noticeId = '';

  const auditHistory = await call<Array<{ changeType: string }>>(`/daily-work/${dailyId}/history`, { cookie: adminLogin.cookie });
  assert.equal(auditHistory.response.status, 200);
  assert.deepEqual(auditHistory.payload.data?.map((entry) => entry.changeType).sort(), ['CREATE', 'UPDATE']);

  const exportResponse = await fetch(`${base}/admin/daily-work/export?mode=person&from=2020-01-02&to=2020-01-02&userId=${testUserId}`, {
    headers: { Cookie: adminLogin.cookie || '' },
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /spreadsheetml/);
  assert.ok((await exportResponse.arrayBuffer()).byteLength > 1000);

  const usage = await call<{ id: string }>('/material-usage', {
    method: 'POST',
    cookie: workerLogin.cookie,
    body: { workDate: '2099.12.31', cellName: legacyCellName, materialName: 'Connector', quantity: 1, unit: 'EA', purpose: 'API 통합 테스트', workDetails: '저장 확인' },
  });
  assert.equal(usage.response.status, 201);
  usageId = usage.payload.data?.id || '';

  const managerLogin = await call('/auth/login', { method: 'POST', body: { username: 'user-4', password: '1234' } });
  const transfer = await call<{ id: string }>('/work-transfers', {
    method: 'POST',
    cookie: managerLogin.cookie,
    body: { serviceNo: `TEST-${suffix}`, cellName: legacyCellName, transferReason: 'API 통합 테스트', requestDetails: '업무이관 저장 확인', status: '대기' },
  });
  assert.equal(transfer.response.status, 201);
  transferId = transfer.payload.data?.id || '';
  const completed = await call(`/work-transfers/${transferId}`, { method: 'PUT', cookie: workerLogin.cookie, body: { status: '완료', comment: '통합 테스트 완료' } });
  assert.equal(completed.response.status, 200);

  const deleteSignupUser = await call(`/admin/users/${testUserId}`, { method: 'DELETE', cookie: adminLogin.cookie });
  assert.equal(deleteSignupUser.response.status, 200);
  const recreatedSignup = await call<{ id: string }>('/auth/signup', {
    method: 'POST',
    body: { username, password: 'Renewed123!', name: '통합테스트 재가입', employeeNumber: `T-${suffix}`, department: '전송망1팀', phone: '010-0000-0000' },
  });
  assert.equal(recreatedSignup.response.status, 201);
  assert.equal(recreatedSignup.payload.data?.id, testUserId);

  console.log('API integration test passed: auth → CELL/B2C search → floor plan/coordinates → daily work → material usage → transfer');
} finally {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (usageId) {
      db.prepare('UPDATE materials SET stock_quantity = stock_quantity + 1 WHERE id = (SELECT material_id FROM material_usage WHERE id = ?)').run(usageId);
      db.prepare('DELETE FROM material_usage WHERE id = ?').run(usageId);
    }
    if (dailyId) {
      db.prepare('DELETE FROM daily_work_history WHERE daily_work_id = ?').run(dailyId);
      db.prepare('DELETE FROM daily_work WHERE id = ?').run(dailyId);
    }
    if (transferId) {
      db.prepare('DELETE FROM work_transfer_logs WHERE transfer_id = ?').run(transferId);
      db.prepare('DELETE FROM work_transfers WHERE id = ?').run(transferId);
    }
    if (testUserId) {
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    }
    if (assetId) db.prepare('DELETE FROM admin_db_assets WHERE id = ?').run(assetId);
    if (archivedAssetId) db.prepare('DELETE FROM admin_db_assets WHERE id = ?').run(archivedAssetId);
    if (floorPlanAssetId) db.prepare('DELETE FROM admin_db_assets WHERE id = ?').run(floorPlanAssetId);
    for (const id of additionalFloorPlanAssetIds) if (id) db.prepare('DELETE FROM admin_db_assets WHERE id = ?').run(id);
    db.prepare("DELETE FROM catv_b2c_lines WHERE source_file = 'B2C_TEST.xlsx'").run();
    db.prepare("DELETE FROM catv_b2c_lines WHERE source_file = 'B2C_TEST_UPDATED.xlsx'").run();
    db.prepare("DELETE FROM catv_floor_plans WHERE station_key = '오산'").run();
    if (managedUserId) {
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(managedUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(managedUserId);
    }
    if (noticeId) db.prepare('DELETE FROM home_notices WHERE id = ?').run(noticeId);
    if (manpowerBefore) {
      db.prepare(`UPDATE catv_manpower_status SET payload_json = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = 1`)
        .run(manpowerBefore.payload_json, manpowerBefore.version, manpowerBefore.updated_at, manpowerBefore.updated_by);
    } else db.prepare('DELETE FROM catv_manpower_status WHERE id = 1').run();
    for (const historyId of uploadHistoryIds) {
      const row = db.prepare('SELECT file_name FROM db_upload_history WHERE id = ?').get(historyId) as { file_name: string } | undefined;
      if (row?.file_name === 'B2C_TEST.xlsx' || row?.file_name === 'B2C_TEST_UPDATED.xlsx') db.prepare('DELETE FROM db_upload_history WHERE id = ?').run(historyId);
    }
    db.prepare('DELETE FROM login_attempts WHERE created_at >= ?').run(auditStart);
    db.prepare('DELETE FROM audit_logs WHERE created_at >= ?').run(auditStart);
    db.prepare("DELETE FROM auth_sessions WHERE user_id IN ('user-4', 'user-5') OR user_id = ? OR user_id = ?")
      .run(testUserId || '', managedUserId || '');
    db.exec('COMMIT');
  } catch (cleanupError) {
    db.exec('ROLLBACK');
    console.error('Test cleanup failed:', cleanupError);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
