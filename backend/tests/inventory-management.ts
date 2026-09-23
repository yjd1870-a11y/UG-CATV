import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import { createApiApp } from '../app';
import { db, initializeDatabase } from '../db';
import { readMaterialPhoto } from '../material-photo-storage';

await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start.');
const base = `http://127.0.0.1:${address.port}/api`;

const call = async <T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => null) as { success: boolean; data?: T; code?: string; message?: string } | null;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
};
const file = async (path: string, cookie: string) => {
  const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { response, body: Buffer.from(await response.arrayBuffer()) };
};
const login = async (username: string) => {
  const result = await call('/auth/login', { method: 'POST', body: { username, password: '1234' } });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
};

const admin = await login('user-5');
const manager = await login('user-1');
const teamLeader = await login('user-4');
db.prepare("UPDATE users SET access_role='public_official' WHERE id='user-2'").run();
const publicOfficial = await login('user-2');
db.prepare("UPDATE users SET access_role='guest' WHERE id='user-3'").run();
const guest = await login('user-3');
const date = new Date().toISOString().slice(0, 10);
const period = date.slice(0, 7);

try {
  const bootstrap = await call<{
    permissions: { canManage:boolean; canViewMaster:boolean; canImportExcel:boolean; canExportExcel:boolean };
    categories: Array<{ id: string; categoryName: string; active:number }>;
    stations: Array<{ id: string; stationName: string }>;
    workers: Array<{ id: string; name: string; regionId?: string }>;
  }>('/material-management/bootstrap', { cookie: admin });
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.payload?.data?.permissions.canManage,true);
  assert.equal(bootstrap.payload?.data?.permissions.canViewMaster,true);
  assert.equal(bootstrap.payload?.data?.permissions.canImportExcel,true);
  assert.equal(bootstrap.payload?.data?.permissions.canExportExcel,true);
  assert.equal(bootstrap.payload?.data?.stations.length, 14);
  assert.equal(bootstrap.payload?.data?.categories.some((row) => row.active && (row.categoryName === '수동소자류' || row.categoryName === '수동소자')), false);
  assert.ok(bootstrap.payload?.data?.categories.some((row) => row.categoryName === '수동소자(옥외용)'));
  assert.ok(bootstrap.payload?.data?.categories.some((row) => row.categoryName === '수동소자(옥내용)'));
  assert.ok(bootstrap.payload?.data?.workers.some((worker) => worker.id === 'user-1'));
  const managerBootstrap = await call<{permissions:{canManage:boolean;canViewMaster:boolean;canImportExcel:boolean;canExportExcel:boolean};workers:Array<{id:string}>}>('/material-management/bootstrap',{cookie:manager});
  assert.deepEqual(managerBootstrap.payload?.data?.workers.map((worker)=>worker.id),['user-1']);
  assert.equal(managerBootstrap.payload?.data?.permissions.canManage,false);
  assert.equal(managerBootstrap.payload?.data?.permissions.canViewMaster,false);
  assert.equal(managerBootstrap.payload?.data?.permissions.canImportExcel,false);
  assert.equal(managerBootstrap.payload?.data?.permissions.canExportExcel,false);
  const teamBootstrap = await call<{permissions:{canManage:boolean;canViewMaster:boolean;canImportExcel:boolean;canExportExcel:boolean};workers:Array<{id:string}>}>('/material-management/bootstrap',{cookie:teamLeader});
  assert.equal(teamBootstrap.payload?.data?.permissions.canManage,false);
  assert.equal(teamBootstrap.payload?.data?.permissions.canViewMaster,false);
  assert.equal(teamBootstrap.payload?.data?.permissions.canImportExcel,false);
  assert.equal(teamBootstrap.payload?.data?.permissions.canExportExcel,false);
  const publicBootstrap = await call<{permissions:{canManage:boolean;canViewMaster:boolean;canImportExcel:boolean;canExportExcel:boolean}}>('/material-management/bootstrap',{cookie:publicOfficial});
  assert.equal(publicBootstrap.payload?.data?.permissions.canManage,true);
  assert.equal(publicBootstrap.payload?.data?.permissions.canViewMaster,true);
  assert.equal(publicBootstrap.payload?.data?.permissions.canImportExcel,false);
  assert.equal(publicBootstrap.payload?.data?.permissions.canExportExcel,true);
  assert.equal((await call('/material-management/field/categories',{method:'POST',cookie:manager,body:{categoryName:'권한차단'}})).response.status,403);
  assert.equal((await call('/material-management/field/categories',{method:'POST',cookie:teamLeader,body:{categoryName:'권한차단'}})).response.status,403);
  const categoryId = bootstrap.payload?.data?.categories.find((row) => row.categoryName === '수동소자(옥외용)')?.id || bootstrap.payload?.data?.categories[0].id;
  assert.ok(categoryId);
  const categoryName = bootstrap.payload?.data?.categories.find((row) => row.id === categoryId)?.categoryName || '';

  const passive = await call<{ id: string }>('/material-management/field/models', { method: 'POST', cookie: admin, body: { categoryId, modelName: '통합테스트 수동모델', quantity: 1, unit: 'EA', materialKind: 'PASSIVE' } });
  assert.equal(passive.response.status, 201);
  const passiveId = passive.payload?.data?.id || '';
  const active = await call<{ id: string }>('/material-management/field/models', { method: 'POST', cookie: admin, body: { categoryName: '직접입력 품명', modelName: '통합테스트 능동모델', quantity: 1, unit: 'EA', materialKind: 'ACTIVE' } });
  assert.equal(active.response.status, 201);
  const activeId = active.payload?.data?.id || '';
  assert.equal((await call(`/material-management/field/models/${passiveId}`, { method: 'DELETE', cookie: admin })).response.status, 409);
  const editableFieldModel = await call<{ id: string }>('/material-management/field/models', { method: 'POST', cookie: admin, body: { categoryName: '수정전 품명', modelName: '수정전 모델', quantity: 1, unit: 'EA', materialKind: 'PASSIVE' } });
  const editableFieldModelId = editableFieldModel.payload?.data?.id || '';
  assert.equal((await call(`/material-management/field/models/${editableFieldModelId}`, { method: 'PUT', cookie: admin, body: { categoryName: '수정후 품명', modelName: '수정후 모델', unit: 'SET', materialKind: 'PASSIVE' } })).response.status, 200);
  const editedFieldModel = db.prepare(`SELECT c.category_name AS categoryName,m.model_name AS modelName,m.unit FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE m.id=?`).get(editableFieldModelId) as { categoryName: string; modelName: string; unit: string };
  assert.equal(editedFieldModel.categoryName, '수정후 품명');
  assert.equal(editedFieldModel.modelName, '수정후 모델');
  assert.equal(editedFieldModel.unit, 'SET');
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'FIELD_USE', effectiveDate: date, modelId: editableFieldModelId, quantity: 1, purpose: '기준정보 삭제 전 재고 소진', idempotencyKey: 'editable-field-model-use' } })).response.status, 201);
  assert.equal((await call(`/material-management/field/models/${editableFieldModelId}`, { method: 'DELETE', cookie: admin })).response.status, 200);
  assert.equal((db.prepare('SELECT active FROM field_material_models WHERE id=?').get(editableFieldModelId) as { active: number }).active, 0);

  const opening = await call<{ id: string }>('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'OPENING', effectiveDate: date, modelId: passiveId, quantity: 10, stockState: 'NORMAL', sourceWorkerId: 'user-1', idempotencyKey: 'field-opening' } });
  assert.equal(opening.response.status, 201);
  assert.equal((db.prepare('SELECT source_worker_name AS workerName FROM inventory_transactions WHERE id=?').get(opening.payload?.data?.id) as {workerName:string}).workerName,'김현장');
  const usageBody = { transactionType: 'FIELD_USE', effectiveDate: date, modelId: passiveId, quantity: 3, stockState: 'NORMAL', purpose: '통합테스트 사용', idempotencyKey: 'field-use-once' };
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: usageBody })).response.status, 201);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: usageBody })).response.status, 200);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { ...usageBody, quantity: 1.5, idempotencyKey: 'field-use-decimal' } })).response.status, 400);
  const insufficient = await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { ...usageBody, quantity: 99, idempotencyKey: 'field-use-too-many' } });
  assert.equal(insufficient.response.status, 409);
  assert.equal(insufficient.payload?.code, 'INSUFFICIENT_STOCK');
  const invalidOpeningReversal = await call(`/material-management/transactions/${opening.payload?.data?.id}/reverse`, { method: 'POST', cookie: admin, body: { reason: '사용 후 기초재고 취소 방지 테스트' } });
  assert.equal(invalidOpeningReversal.response.status, 409);
  assert.equal(invalidOpeningReversal.payload?.code, 'REVERSAL_WOULD_NEGATIVE');
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'OTHER_COMPANY_ISSUE', effectiveDate: date, modelId: passiveId, quantity: 1, companyName: '협력사', purpose: '타사 긴급 분출', idempotencyKey: 'field-other-company' } })).response.status, 201);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'HS_ISSUE', effectiveDate: date, modelId: passiveId, quantity: 1, companyName: 'H&S', location: '수원동부', purpose: '구내증폭기 분출', idempotencyKey: 'field-hs' } })).response.status, 201);
  type UsageStatistics = { totals: { totalQuantity: number; fieldUseQuantity: number; issueQuantity: number; transactionCount: number; workerCount: number }; byRegion: Array<{label:string;quantity:number}>; byWorker: Array<{label:string;quantity:number}> };
  const adminStatistics = await call<UsageStatistics>(`/material-management/field/statistics?start=${period}-01&end=${date}`, { cookie: admin });
  assert.equal(adminStatistics.response.status, 200);
  const statisticsMeta = await call<{regions:Array<{id:string;name:string}>;workers:Array<{name:string;regionName:string}>}>('/material-management/field/statistics/meta', { cookie: admin });
  assert.equal(statisticsMeta.response.status, 200);
  assert.ok(statisticsMeta.payload?.data?.regions.length && statisticsMeta.payload.data.regions.length >= 1);
  assert.ok(statisticsMeta.payload?.data?.workers.some((worker)=>worker.name==='김현장'));
  assert.ok(Number(adminStatistics.payload?.data?.totals.totalQuantity) >= 6);
  assert.equal(Number(adminStatistics.payload?.data?.totals.issueQuantity), 2);
  const issueOnlyStatistics = await call<UsageStatistics>(`/material-management/field/statistics?start=${period}-01&end=${date}&issuesOnly=1`, { cookie: admin });
  assert.equal(issueOnlyStatistics.response.status, 200);
  assert.equal(Number(issueOnlyStatistics.payload?.data?.totals.totalQuantity), 2);
  assert.equal(Number(issueOnlyStatistics.payload?.data?.totals.fieldUseQuantity), 0);
  assert.equal(Number(issueOnlyStatistics.payload?.data?.totals.issueQuantity), 2);
  const issueOnlyItems = await call<Array<{modelName:string;quantity:number}>>(`/material-management/field/statistics/items?start=${period}-01&end=${date}&group=ALL&issuesOnly=1`, { cookie: admin });
  assert.equal(Number(issueOnlyItems.payload?.data?.find((row)=>row.modelName==='통합테스트 수동모델')?.quantity), 2);
  const itemStatistics = await call<Array<{categoryName:string;modelName:string;quantity:number;count:number}>>(`/material-management/field/statistics/items?start=${period}-01&end=${date}&group=ALL`, { cookie: admin });
  assert.equal(itemStatistics.response.status, 200);
  assert.equal(Number(itemStatistics.payload?.data?.find((row)=>row.modelName==='통합테스트 수동모델')?.quantity), 5);
  const issueDetails = await call<Array<{effectiveDate:string;releasePlace:string;issueType:string;categoryName:string;modelName:string;quantity:number}>>(`/material-management/field/statistics/issues?start=${period}-01&end=${date}&group=ALL`, { cookie: admin });
  assert.equal(issueDetails.response.status, 200);
  assert.equal(issueDetails.payload?.data?.length, 2);
  assert.ok(issueDetails.payload?.data?.every((row)=>row.effectiveDate===date && row.categoryName===categoryName && row.modelName==='통합테스트 수동모델' && Number(row.quantity)===1));
  assert.ok(issueDetails.payload?.data?.some((row)=>row.issueType==='타사 분출' && row.releasePlace==='협력사'));
  assert.ok(issueDetails.payload?.data?.some((row)=>row.issueType==='H&S 분출' && row.releasePlace==='수원동부'));
  assert.equal((await call(`/material-management/field/statistics/items?start=${period}-01&end=${date}&group=WORKER`, { cookie: admin })).response.status, 400);
  const managerRegionName = (db.prepare("SELECT r.region_name AS regionName FROM users u JOIN regions r ON r.id=u.region_id WHERE u.id='user-1'").get() as {regionName:string}).regionName;
  const filteredStatistics = await call<UsageStatistics>(`/material-management/field/statistics?start=${period}-01&end=${date}&region=${encodeURIComponent(managerRegionName)}&category=${encodeURIComponent(categoryName)}&model=${encodeURIComponent('통합테스트 수동모델')}&worker=${encodeURIComponent('김현장')}`, { cookie: admin });
  assert.equal(filteredStatistics.response.status, 200);
  assert.equal(Number(filteredStatistics.payload?.data?.totals.totalQuantity), 3);
  assert.equal(Number(filteredStatistics.payload?.data?.totals.transactionCount), 1);
  const managerStatistics = await call<UsageStatistics>(`/material-management/field/statistics?start=${period}-01&end=${date}`, { cookie: manager });
  assert.equal(managerStatistics.response.status, 200);
  assert.equal(Number(managerStatistics.payload?.data?.totals.totalQuantity), 6);
  assert.deepEqual(managerStatistics.payload?.data?.byWorker.map((row) => row.label), ['김현장']);
  assert.equal((await call(`/material-management/field/statistics?start=${date}&end=${period}-01`, { cookie: admin })).response.status, 400);

  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'RECOVERED_BAD', effectiveDate: date, modelId: passiveId, quantity: 2, stockState: 'BAD', idempotencyKey: 'field-bad' } })).response.status, 201);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'REPAIR_OUT', effectiveDate: date, modelId: passiveId, quantity: 1, stockState: 'BAD', idempotencyKey: 'manager-repair' } })).response.status, 403);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: teamLeader, body: { transactionType: 'RECOVERED_BAD', effectiveDate: date, modelId: passiveId, quantity: 1, stockState: 'BAD', sourceWorkerId: teamBootstrap.payload?.data?.workers[0]?.id, idempotencyKey: 'team-field-bad' } })).response.status, 201);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: teamLeader, body: { transactionType: 'REPAIR_OUT', effectiveDate: date, modelId: passiveId, quantity: 1, stockState: 'BAD', sourceWorkerId: teamBootstrap.payload?.data?.workers[0]?.id, purpose: '권한차단', idempotencyKey: 'team-repair' } })).response.status, 403);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'REPAIR_OUT', effectiveDate: date, modelId: passiveId, quantity: 1, stockState: 'BAD', purpose: '수리출고', idempotencyKey: 'admin-repair' } })).response.status, 201);
  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'DISPOSAL', effectiveDate: date, modelId: passiveId, quantity: 1, stockState: 'BAD', purpose: '수리불가 폐기', idempotencyKey: 'admin-disposal' } })).response.status, 201);

  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'OPENING', effectiveDate: date, modelId: activeId, quantity: 3, stockState: 'NORMAL', idempotencyKey: 'active-opening' } })).response.status, 201);
  const missingPhotos = await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'FIELD_USE', effectiveDate: date, modelId: activeId, quantity: 1, stockState: 'NORMAL', purpose: '사진 누락', idempotencyKey: 'active-missing' } });
  assert.equal(missingPhotos.response.status, 400);
  const before = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#2266aa' } }).png().toBuffer();
  const after = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ee8822' } }).png().toBuffer();
  const activeUse = await call('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'FIELD_USE', effectiveDate: date, modelId: activeId, quantity: 1, stockState: 'NORMAL', purpose: '능동 교체', workDetails: '전후 사진 포함', beforePhoto: `data:image/png;base64,${before.toString('base64')}`, afterPhoto: `data:image/png;base64,${after.toString('base64')}`, idempotencyKey: 'active-photo-use' } });
  assert.equal(activeUse.response.status, 201);
  const photoRows = db.prepare("SELECT * FROM material_photo_assets").all() as Array<Record<string, unknown>>;
  assert.equal(photoRows.length, 2);
  assert.notEqual(photoRows[0].sha256, photoRows[1].sha256);
  assert.ok(Number(photoRows[0].width) <= 1280);
  const activeDelete = await call<{id:string}>('/material-management/field/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'FIELD_USE', effectiveDate: date, modelId: activeId, quantity: 1, stockState: 'NORMAL', purpose: '오등록 삭제', workDetails: '사진 삭제 검증', beforePhoto: `data:image/png;base64,${before.toString('base64')}`, afterPhoto: `data:image/png;base64,${after.toString('base64')}`, idempotencyKey: 'active-photo-delete' } });
  assert.equal(activeDelete.response.status,201);
  const deletePhotoRows=db.prepare('SELECT object_key AS objectKey,thumbnail_object_key AS thumbnailObjectKey FROM material_photo_assets WHERE transaction_id=?').all(activeDelete.payload?.data?.id) as Array<{objectKey:string;thumbnailObjectKey:string}>;
  assert.equal(deletePhotoRows.length,2);
  assert.equal((await call(`/material-management/field/transactions/${activeDelete.payload?.data?.id}`,{method:'DELETE',cookie:admin,body:{reason:'능동자재 오등록 삭제'}})).response.status,200);
  for(const photo of deletePhotoRows){
    await assert.rejects(()=>readMaterialPhoto(photo.objectKey));
    await assert.rejects(()=>readMaterialPhoto(photo.thumbnailObjectKey));
  }
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE transaction_id=? AND archive_status='DELETED' AND purge_status='DELETED'").get(activeDelete.payload?.data?.id) as {count:number}).count),2);

  const fieldBalances = await call<Array<{ modelId: string; normalQuantity: number; badQuantity: number }>>('/material-management/field/balances', { cookie: admin });
  const passiveBalance = fieldBalances.payload?.data?.find((row) => row.modelId === passiveId);
  assert.equal(passiveBalance?.normalQuantity, 6);
  assert.equal(passiveBalance?.badQuantity, 1);

  const batch = await call<{ count: number }>('/material-management/field/transactions/batch', { method: 'POST', cookie: manager, body: {
    effectiveDate: date, location: '경기도 평택시 동일작업로 10', purpose: '증폭기 교체 및 불량자재 동시 회수', idempotencyKey: 'multi-material-work',
    items: [
      { transactionType: 'FIELD_USE', modelId: passiveId, quantity: 1, stockState: 'NORMAL', idempotencyKey: 'multi-material-use' },
      { transactionType: 'RECOVERED_BAD', modelId: passiveId, quantity: 2, stockState: 'BAD', idempotencyKey: 'multi-material-bad' },
    ],
  } });
  assert.equal(batch.response.status, 201); assert.equal(batch.payload?.data?.count, 2);
  const sharedWork = db.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE location_text=? AND purpose=? AND status='POSTED'").get('경기도 평택시 동일작업로 10', '증폭기 교체 및 불량자재 동시 회수') as { count: number };
  assert.equal(sharedWork.count, 2);
  const ledgerAfterBatch = await call<Array<{ transactionType: string; categoryName: string; modelName: string }>>('/material-management/field/transactions', { cookie: admin });
  assert.equal(ledgerAfterBatch.payload?.data?.find((row) => row.transactionType === 'FIELD_USE' && row.modelName === '통합테스트 수동모델')?.categoryName, categoryName);
  const failedBatch = await call('/material-management/field/transactions/batch', { method: 'POST', cookie: manager, body: {
    effectiveDate: date, location: '경기도 평택시 원자성테스트로 20', purpose: '전체 취소 검증', idempotencyKey: 'atomic-batch',
    items: [
      { transactionType: 'FIELD_USE', modelId: passiveId, quantity: 1, idempotencyKey: 'atomic-first-use' },
      { transactionType: 'FIELD_USE', modelId: passiveId, quantity: 999, idempotencyKey: 'atomic-failure' },
    ],
  } });
  assert.equal(failedBatch.response.status, 409);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM inventory_transactions WHERE purpose=?').get('전체 취소 검증') as { count: number }).count, 0);

  const teamRegion = db.prepare("SELECT region_id AS regionId FROM users WHERE id='user-4'").get() as { regionId: string };
  const otherRegion = db.prepare('SELECT id FROM regions WHERE id<>? AND active=1 ORDER BY sort_order LIMIT 1').get(teamRegion.regionId) as { id: string };
  const ownRegionReceipt = await call<{ id: string }>('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 2, regionId: teamRegion.regionId, address: '경기도 평택시 통합테스트로 1', idempotencyKey: 'team-own-region-edit' } });
  assert.equal(ownRegionReceipt.response.status, 201);
  assert.equal((await call(`/material-management/field/transactions/${ownRegionReceipt.payload?.data?.id}/quantity`, { method: 'PUT', cookie: teamLeader, body: { quantity: 4, reason: '팀장 수정 차단 확인' } })).response.status, 403);
  assert.equal((await call(`/material-management/field/transactions/${ownRegionReceipt.payload?.data?.id}/quantity`, { method: 'PUT', cookie: publicOfficial, body: { quantity: 4, reason: '공무 담당지역 수량 정정' } })).response.status, 200);
  const otherRegionReceipt = await call<{ id: string }>('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 2, regionId: otherRegion.id, address: '', idempotencyKey: 'other-region-edit' } });
  assert.equal(otherRegionReceipt.response.status, 201);
  assert.equal((await call(`/material-management/field/transactions/${otherRegionReceipt.payload?.data?.id}/quantity`, { method: 'PUT', cookie: teamLeader, body: { quantity: 3, reason: '타지역 수정 차단 확인' } })).response.status, 403);
  assert.equal((await call(`/material-management/field/transactions/${otherRegionReceipt.payload?.data?.id}/quantity`, { method: 'PUT', cookie: publicOfficial, body: { quantity: 3, reason: '공무 전지역 수정' } })).response.status, 200);
  const adminRegionReceipt = await call<{ id: string }>('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 1, regionId: otherRegion.id, idempotencyKey: 'admin-region-edit' } });
  assert.equal((await call(`/material-management/field/transactions/${adminRegionReceipt.payload?.data?.id}/quantity`, { method: 'PUT', cookie: admin, body: { quantity: 2, reason: '관리자 전지역 수정' } })).response.status, 200);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE original_transaction_id=? AND transaction_type='REVERSAL'").get(ownRegionReceipt.payload?.data?.id) as { count: number }).count, 0);

  const teamLedger = await call<Array<{id:string}>>('/material-management/field/transactions',{cookie:teamLeader});
  assert.equal(teamLedger.payload?.data?.some((row)=>row.id===ownRegionReceipt.payload?.data?.id),true);
  assert.equal(teamLedger.payload?.data?.some((row)=>row.id===otherRegionReceipt.payload?.data?.id),false);
  assert.equal((await call(`/material-management/transactions/${otherRegionReceipt.payload?.data?.id}`,{cookie:teamLeader})).response.status,404);
  assert.equal((await call(`/material-management/transactions/${otherRegionReceipt.payload?.data?.id}`,{cookie:admin})).response.status,200);
  const managerLedger = await call<Array<{id:string}>>('/material-management/field/transactions',{cookie:manager});
  assert.equal(managerLedger.payload?.data?.some((row)=>row.id===ownRegionReceipt.payload?.data?.id),true);

  const fullEdit = await call(`/material-management/field/transactions/${ownRegionReceipt.payload?.data?.id}`, { method: 'PUT', cookie: publicOfficial, body: {
    transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 5,
    regionId: teamRegion.regionId, location: '담당지역 수정주소 101', purpose: '주소와 수량 정정', workDetails: '주소와 수량 정정', reason: '입력 오류 수정',
  } });
  assert.equal(fullEdit.response.status, 200);
  const editedLedger = await call<Array<{ id: string; quantity: number; location: string; regionId: string; transactionType: string }>>('/material-management/field/transactions', { cookie: admin });
  const editedRow = editedLedger.payload?.data?.find((row) => row.id === ownRegionReceipt.payload?.data?.id);
  assert.equal(editedRow?.quantity, 5);
  assert.equal(editedRow?.location, '담당지역 수정주소 101');
  assert.equal(editedRow?.regionId, teamRegion.regionId);
  assert.equal(editedLedger.payload?.data?.some((row) => row.transactionType === 'REVERSAL'), false);

  const deleteTarget = await call<{ id: string }>('/material-management/field/transactions', { method: 'POST', cookie: admin, body: {
    transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 2,
    regionId: teamRegion.regionId, address: '삭제 검증주소', idempotencyKey: 'direct-delete-test',
  } });
  assert.equal(deleteTarget.response.status, 201);
  const balanceBeforeDelete = Number((await call<Array<{ modelId: string; normalQuantity: number }>>('/material-management/field/balances', { cookie: admin })).payload?.data?.find((row) => row.modelId === passiveId)?.normalQuantity);
  assert.equal((await call(`/material-management/field/transactions/${deleteTarget.payload?.data?.id}`, { method: 'DELETE', cookie: teamLeader, body: { reason: '팀장 삭제 차단 확인' } })).response.status, 403);
  assert.equal((await call(`/material-management/field/transactions/${deleteTarget.payload?.data?.id}`, { method: 'DELETE', cookie: admin, body: { reason: '잘못 등록한 자재 삭제' } })).response.status, 200);
  const balanceAfterDelete = Number((await call<Array<{ modelId: string; normalQuantity: number }>>('/material-management/field/balances', { cookie: admin })).payload?.data?.find((row) => row.modelId === passiveId)?.normalQuantity);
  assert.equal(balanceAfterDelete, balanceBeforeDelete - 2);
  const ledgerAfterDelete = await call<Array<{ id: string }>>('/material-management/field/transactions', { cookie: admin });
  assert.equal(ledgerAfterDelete.payload?.data?.some((row) => row.id === deleteTarget.payload?.data?.id), false);
  assert.equal((await call(`/material-management/field/transactions/${otherRegionReceipt.payload?.data?.id}`, { method: 'DELETE', cookie: teamLeader, body: { reason: '타지역 삭제 차단' } })).response.status, 403);

  const reportYear = date.slice(0, 4);
  const officialRows = [
    { sheetName: '사급자재 사용내역', rowNumber: 10, transactionType: 'OPENING', effectiveDate: `${reportYear}-01-01`, categoryName: '대량등록테스트', modelName: 'OFFICIAL-IMPORT-01', unit: 'EA', quantity: 5, stockState: 'NORMAL' },
    { sheetName: '사급자재 사용내역', rowNumber: 10, transactionType: 'RECEIPT', effectiveDate: `${reportYear}-01-01`, categoryName: '대량등록테스트', modelName: 'OFFICIAL-IMPORT-01', unit: 'EA', quantity: 2 },
    { sheetName: '사급자재 사용내역', rowNumber: 10, transactionType: 'RECEIPT', effectiveDate: `${reportYear}-02-01`, categoryName: '대량등록테스트', modelName: 'OFFICIAL-IMPORT-01', unit: 'EA', quantity: 3 },
    { sheetName: '센터 자재 사용내역(03월)', rowNumber: 7, transactionType: 'FIELD_USE', effectiveDate: `${Number(reportYear) - 1}-12-29`, categoryName: '공사성자재', modelName: 'OFFICIAL-IMPORT-01', unit: 'EA', quantity: 1, address: '수원시 팔달구 테스트로 1', workCategory: '교체', workDetails: '공식파일 대량등록 검증', workerName: '원본작업자' },
  ];
  const exactSourceWorkbook = new ExcelJS.Workbook();
  exactSourceWorkbook.addWorksheet('원본보존검증').getCell('A1').value = '업로드 원본 그대로';
  const exactSourceBuffer = Buffer.from(await exactSourceWorkbook.xlsx.writeBuffer());
  const exactSourceHash = createHash('sha256').update(exactSourceBuffer).digest('hex');
  const authoritativeRows = [...officialRows,
    { sheetName: '센터 자재 사용내역(01월)', rowNumber: 303, transactionType: 'RECOVERED_BAD', effectiveDate: `${reportYear}-01-20`, categoryName: 'ONU', modelName: '폐기모델-요약시트없음', unit: 'EA', quantity: 2, stockState: 'BAD', workCategory: '불량' },
  ];
  const importBody = { sourceFile: '공식월간보고_통합테스트.xlsx', sourceHash: exactSourceHash, sourceWorkbookBase64: exactSourceBuffer.toString('base64'), reportYear: Number(reportYear), rows: authoritativeRows };
  assert.equal((await call('/material-management/field/imports/official',{method:'POST',cookie:publicOfficial,body:importBody})).response.status,403);
  assert.equal((await call('/material-management/field/imports/official',{method:'POST',cookie:teamLeader,body:importBody})).response.status,403);
  const imported = await call<{ inserted: number; skipped: number }>('/material-management/field/imports/official', { method: 'POST', cookie: admin, body: importBody });
  assert.equal(imported.response.status, 201); assert.equal(imported.payload?.data?.inserted, 4);
  const importedAgain = await call<{ inserted: number; skipped: number }>('/material-management/field/imports/official', { method: 'POST', cookie: admin, body: importBody });
  assert.equal(importedAgain.payload?.data?.inserted, 0); assert.equal(importedAgain.payload?.data?.skipped, 5);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM field_material_models WHERE model_name='폐기모델-요약시트없음'").get() as {count:number}).count,0);
  const exactDownload = await file(`/material-management/exports/field-official.xlsx?year=${reportYear}`, admin);
  assert.equal(exactDownload.response.status, 200);
  assert.deepEqual(exactDownload.body, exactSourceBuffer);
  const importedModel = db.prepare("SELECT id FROM field_material_models WHERE model_name='OFFICIAL-IMPORT-01'").get() as { id: string };
  assert.equal((await call<Array<{ modelId: string; normalQuantity: number }>>('/material-management/field/balances', { cookie: admin })).payload?.data?.find((row) => row.modelId === importedModel.id)?.normalQuantity, 9);
  const importedLedger = await call<Array<{ modelName:string; categoryName:string; transactionType:string; workerName:string }>>('/material-management/field/transactions', { cookie: admin });
  const importedUsage = importedLedger.payload?.data?.find((row)=>row.modelName==='OFFICIAL-IMPORT-01' && row.transactionType==='FIELD_USE');
  assert.deepEqual(importedUsage && [importedUsage.categoryName,importedUsage.transactionType,importedUsage.workerName],['공사성자재','FIELD_USE','원본작업자']);
  const importedDates = db.prepare(`
    SELECT effective_date AS effectiveDate,source_effective_date AS sourceEffectiveDate
      FROM inventory_transactions
     WHERE id=(SELECT transaction_id FROM field_material_entries WHERE model_id=? AND signed_quantity=-1 LIMIT 1)
  `).get(importedModel.id) as { effectiveDate: string; sourceEffectiveDate: string };
  assert.equal(importedDates.effectiveDate, `${reportYear}-01-29`);
  assert.equal(importedDates.sourceEffectiveDate, `${Number(reportYear)-1}-12-29`);

  const historicalUseWithoutOpening = await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'공식월간보고_과거사용.xlsx',sourceHash:'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',reportYear:Number(reportYear),rows:[
      {sheetName:'센터 자재 사용내역(01월)',rowNumber:7,transactionType:'FIELD_USE',effectiveDate:`${Number(reportYear)-1}-12-31`,categoryName:'구내증폭기',modelName:'과거자료-무재고모델',unit:'EA',quantity:4,address:'수원시 테스트',workCategory:'교체'},
      {sheetName:'사급자재 사용내역',rowNumber:34,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'구내증폭기',modelName:'과거자료-무재고모델',unit:'EA',quantity:0,stockState:'NORMAL',stocktakeTarget:true},
    ],
  }});
  assert.equal(historicalUseWithoutOpening.response.status,201);
  assert.equal(historicalUseWithoutOpening.payload?.data?.inserted,2);
  const historicalUseDate=db.prepare(`
    SELECT t.effective_date AS effectiveDate
      FROM inventory_transactions t
     JOIN field_material_entries e ON e.transaction_id=t.id
      JOIN field_material_models m ON m.id=e.model_id
     WHERE m.model_name='과거자료-무재고모델' AND t.transaction_type='FIELD_USE'
     ORDER BY t.created_at DESC LIMIT 1
  `).get() as {effectiveDate:string}|undefined;
  assert.equal(historicalUseDate?.effectiveDate,`${reportYear}-01-31`);

  const summaryStockBody={
    sourceFile:'공식월간보고_현재고기준.xlsx',sourceHash:'1111111111111111111111111111111111111111111111111111111111111111',reportYear:Number(reportYear),rows:[
      {sheetName:'사급자재 사용내역',rowNumber:120,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'현재고기준테스트',modelName:'L-I-CURRENT-STOCK',unit:'EA',quantity:50,stockState:'NORMAL'},
      {sheetName:'사급자재 사용내역',rowNumber:120,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'현재고기준테스트',modelName:'L-I-CURRENT-STOCK',unit:'EA',quantity:10,stockState:'BAD'},
      {sheetName:'센터 자재 사용내역(01월)',rowNumber:7,transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-15`,categoryName:'현재고기준테스트',modelName:'L-I-CURRENT-STOCK',unit:'EA',quantity:5,address:'수원시 테스트',workCategory:'교체'},
      {sheetName:'사급자재 사용내역',rowNumber:120,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'현재고기준테스트',modelName:'L-I-CURRENT-STOCK',unit:'EA',quantity:12,stockState:'NORMAL',stocktakeTarget:true,stocktakeSourceColumn:'L'},
      {sheetName:'사급자재 사용내역',rowNumber:120,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'현재고기준테스트',modelName:'L-I-CURRENT-STOCK',unit:'EA',quantity:4,stockState:'BAD',stocktakeTarget:true,stocktakeSourceColumn:'I'},
    ],
  };
  const summaryStockImport=await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:summaryStockBody});
  assert.equal(summaryStockImport.response.status,201);
  const summaryStockModel=db.prepare("SELECT id FROM field_material_models WHERE model_name='L-I-CURRENT-STOCK'").get() as {id:string};
  let summaryBalances=await call<Array<{modelId:string;normalQuantity:number;badQuantity:number}>>('/material-management/field/balances',{cookie:admin});
  assert.deepEqual(summaryBalances.payload?.data?.filter((row)=>row.modelId===summaryStockModel.id).map((row)=>[row.normalQuantity,row.badQuantity]),[[12,4]]);
  assert.equal((await call('/material-management/field/transactions',{method:'POST',cookie:admin,body:{transactionType:'RECEIPT',effectiveDate:date,modelId:summaryStockModel.id,quantity:3,idempotencyKey:'summary-stock-drift'}})).response.status,201);
  assert.equal((await call('/material-management/field/imports/official',{method:'POST',cookie:admin,body:summaryStockBody})).response.status,201);
  summaryBalances=await call<Array<{modelId:string;normalQuantity:number;badQuantity:number}>>('/material-management/field/balances',{cookie:admin});
  assert.deepEqual(summaryBalances.payload?.data?.filter((row)=>row.modelId===summaryStockModel.id).map((row)=>[row.normalQuantity,row.badQuantity]),[[12,4]]);
  const correctedRows=officialRows.map((row)=>row.transactionType==='OPENING'?{...row,quantity:8}:row);
  const corrected=await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{sourceFile:'공식월간보고_통합테스트_수정.xlsx',sourceHash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',rows:correctedRows}});
  assert.equal(corrected.response.status,201);assert.equal(corrected.payload?.data?.inserted,4);
  assert.equal((await call<Array<{modelId:string;normalQuantity:number}>>('/material-management/field/balances',{cookie:admin})).payload?.data?.find((row)=>row.modelId===importedModel.id)?.normalQuantity,12);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM inventory_transactions t JOIN field_material_entries e ON e.transaction_id=t.id WHERE e.model_id=? AND t.memo LIKE '원본:%' AND t.status='POSTED'").get(importedModel.id) as {count:number}).count,4);

  const normalizedImport=await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'공식월간보고_공백차이.xlsx',sourceHash:'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',rows:[
      {sheetName:'사급자재 사용내역',rowNumber:116,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'공사성 자재',modelName:'탭브라켓(스탠) [원형(대)]',unit:'EA',quantity:10,stockState:'NORMAL'},
      {sheetName:'센터 자재 사용내역(01월)',rowNumber:161,transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-15`,categoryName:'공사성자재',modelName:'탭브라켓(스탠)  [원형(대)]',unit:'EA',quantity:2,address:'수원시 권선구 테스트',workCategory:'교체'},
    ],
  }});
  assert.equal(normalizedImport.response.status,201);assert.equal(normalizedImport.payload?.data?.inserted,2);
  const normalizedModels=db.prepare("SELECT m.id FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE REPLACE(c.category_name,' ','')='공사성자재' AND REPLACE(m.model_name,' ','')='탭브라켓(스탠)[원형(대)]'").all() as Array<{id:string}>;
  assert.equal(normalizedModels.length,1);
  assert.equal((await call<Array<{modelId:string;normalQuantity:number}>>('/material-management/field/balances',{cookie:admin})).payload?.data?.find((row)=>row.modelId===normalizedModels[0].id)?.normalQuantity,8);

  const aliasCategoryImport=await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'공식월간보고_품명별칭.xlsx',sourceHash:'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',rows:[
      {sheetName:'사급자재 사용내역',rowNumber:117,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'수동소자(옥내용)',modelName:'별칭-유일모델',unit:'EA',quantity:7,stockState:'NORMAL'},
      {sheetName:'센터 자재 사용내역(01월)',rowNumber:70,transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-20`,categoryName:'옥내용분배기',modelName:'별칭-유일모델',unit:'EA',quantity:2,address:'용인시 테스트',workCategory:'교체'},
    ],
  }});
  assert.equal(aliasCategoryImport.response.status,201);assert.equal(aliasCategoryImport.payload?.data?.inserted,2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM field_material_models WHERE model_name='별칭-유일모델'").get() as {count:number}).count,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM field_material_categories WHERE category_name='옥내용분배기'").get() as {count:number}).count,0);

  const duplicateLegacyAliasImport=await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'공식월간보고_수동소자별칭.xlsx',sourceHash:'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',rows:[
      {sheetName:'사급자재 사용내역',rowNumber:71,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'수동소자(옥외용)',modelName:'DC-08',unit:'EA',quantity:10,stockState:'NORMAL'},
      {sheetName:'센터 자재 사용내역(01월)',rowNumber:272,transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-20`,categoryName:'수동소자',modelName:'DC-08',unit:'EA',quantity:2,address:'평택시 테스트',workCategory:'교체'},
      {sheetName:'사급자재 사용내역',rowNumber:71,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'수동소자(옥외용)',modelName:'DC-08',unit:'EA',quantity:3,stockState:'NORMAL',stocktakeTarget:true},
    ],
  }});
  assert.equal(duplicateLegacyAliasImport.response.status,201);
  const activeDc08=db.prepare(`SELECT m.id FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE m.model_name='DC-08' AND m.active=1 AND c.active=1`).get() as {id:string};
  assert.equal((await call<Array<{modelId:string;normalQuantity:number}>>('/material-management/field/balances',{cookie:admin})).payload?.data?.find((row)=>row.modelId===activeDc08.id)?.normalQuantity,3);

  const stationModel = await call<{ id: string }>('/material-management/station/models', { method: 'POST', cookie: admin, body: { manufacturer: 'TEST', itemType: '광수신기', modelName: 'STATION-TEST', unit: 'EA' } });
  assert.equal(stationModel.response.status, 201);
  const stationModelId = stationModel.payload?.data?.id || '';
  const editableSpareModel = await call<{ id: string }>('/material-management/station/models', { method: 'POST', cookie: admin, body: { manufacturer: '수정전', itemType: '수정전 품목', modelName: '수정전 예비품', unit: 'EA' } });
  const editableSpareModelId = editableSpareModel.payload?.data?.id || '';
  assert.equal((await call(`/material-management/station/models/${editableSpareModelId}`, { method: 'PUT', cookie: admin, body: { manufacturer: '수정후', itemType: '수정후 품목', modelName: '수정후 예비품', unit: 'SET' } })).response.status, 200);
  assert.equal((await call(`/material-management/station/models/${editableSpareModelId}`, { method: 'DELETE', cookie: admin })).response.status, 200);
  assert.equal((db.prepare('SELECT active FROM spare_models WHERE id=?').get(editableSpareModelId) as { active: number }).active, 0);
  const stations = bootstrap.payload?.data?.stations || [];
  const source = stations[0].id, destination = stations[1].id;
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'OPENING', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 5, stockState: 'SERVICEABLE', idempotencyKey: 'station-opening' } })).response.status, 201);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'OPENING', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 1.5, stockState: 'SERVICEABLE', idempotencyKey: 'station-opening-decimal' } })).response.status, 400);
  const useWithDefective = await call<{ count: number }>('/material-management/station/transactions/batch', { method: 'POST', cookie: manager, body: {
    effectiveDate: date, stationId: source, purpose: '현장 장애교체 및 불량품 회수', idempotencyKey: 'station-use-with-defective',
    items: [
      { transactionType: 'USE', modelId: stationModelId, quantity: 1, stockState: 'SERVICEABLE', idempotencyKey: 'station-use' },
      { transactionType: 'RECOVERED_DEFECTIVE', modelId: stationModelId, quantity: 1, stockState: 'DEFECTIVE', idempotencyKey: 'station-defective-recovery' },
    ],
  } });
  assert.equal(useWithDefective.response.status, 201);
  assert.equal(useWithDefective.payload?.data?.count, 2);
  const balanceAfterCombinedUse = await call<Array<{ stationId: string; modelId: string; serviceableQuantity: number; defectiveQuantity: number }>>('/material-management/station/balances', { cookie: admin });
  const combinedUseBalance = balanceAfterCombinedUse.payload?.data?.find((row) => row.stationId === source && row.modelId === stationModelId);
  assert.equal(combinedUseBalance?.serviceableQuantity, 4);
  assert.equal(combinedUseBalance?.defectiveQuantity, 1);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'TRANSFER', effectiveDate: date, modelId: stationModelId, stationId: source, destinationStationId: destination, quantity: 1, stockState: 'SERVICEABLE', idempotencyKey: 'manager-transfer' } })).response.status, 403);
  const transfer = await call<{ id: string }>('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'TRANSFER', effectiveDate: date, modelId: stationModelId, stationId: source, destinationStationId: destination, quantity: 2, stockState: 'SERVICEABLE', purpose: '재배치', idempotencyKey: 'admin-transfer' } });
  assert.equal(transfer.response.status, 201);
  const stationBalances = await call<Array<{ stationId: string; modelId: string; serviceableQuantity: number }>>('/material-management/station/balances', { cookie: admin });
  assert.equal(stationBalances.payload?.data?.find((row) => row.stationId === source && row.modelId === stationModelId)?.serviceableQuantity, 2);
  assert.equal(stationBalances.payload?.data?.find((row) => row.stationId === destination && row.modelId === stationModelId)?.serviceableQuantity, 2);
  assert.equal((await call(`/material-management/transactions/${transfer.payload?.data?.id}/reverse`, { method: 'POST', cookie: admin, body: { reason: '이동 테스트 취소' } })).response.status, 201);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: manager, body: { transactionType: 'DEFECT_CONVERSION', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 2, fromState: 'SERVICEABLE', workDetails: '광출력 불량', idempotencyKey: 'station-defect' } })).response.status, 201);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'REPAIR_OUT', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 2, vendorName: 'TEST 수리센터', workDetails: '광출력 불량', idempotencyKey: 'station-repair-out' } })).response.status, 201);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'REPAIR_COMPLETE', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 1, purpose: '부분 수리완료', idempotencyKey: 'station-repair-complete' } })).response.status, 201);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'REPAIR_UNREPAIRABLE', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 1, purpose: '잔여 1개 수리불가', idempotencyKey: 'station-repair-unrepairable' } })).response.status, 201);
  const repairCase = db.prepare("SELECT outbound_quantity,resolved_quantity,status FROM spare_repair_cases WHERE model_id=?").get(stationModelId) as { outbound_quantity: number; resolved_quantity: number; status: string };
  assert.equal(repairCase.outbound_quantity, 2); assert.equal(repairCase.resolved_quantity, 2); assert.equal(repairCase.status, 'CLOSED');
  const balanceAfterUnrepairable = await call<Array<{ stationId: string; modelId: string; defectiveQuantity: number; inRepairQuantity: number }>>('/material-management/station/balances', { cookie: admin });
  const unrepairableBalance = balanceAfterUnrepairable.payload?.data?.find((row) => row.stationId === source && row.modelId === stationModelId);
  assert.equal(unrepairableBalance?.defectiveQuantity, 2);
  assert.equal(unrepairableBalance?.inRepairQuantity, 0);
  assert.equal((await call('/material-management/station/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'DISPOSAL', effectiveDate: date, modelId: stationModelId, stationId: source, quantity: 2, purpose: '불량 및 수리불가품 폐기', idempotencyKey: 'station-defective-disposal' } })).response.status, 201);

  const stationImportBody = {
    sourceFile: 'CATV_국사예비품_테스트.xlsx',
    sourceHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    rows: [{
      sheetName: '국사별 현재고', rowNumber: 2, effectiveDate: date, regionName: '기남', stationName: '일괄등록국사',
      manufacturer: '테스트사', itemType: '광수신기', modelName: 'BULK-STATION-01', unit: 'EA',
      newQuantity: 2, serviceableQuantity: 3, defectiveQuantity: 1, inRepairQuantity: 0,
    }],
  };
  const stationImport = await call<{ inserted: number; skipped: number }>('/material-management/station/imports/inventory', { method: 'POST', cookie: admin, body: stationImportBody });
  assert.equal(stationImport.response.status, 201);
  assert.equal(stationImport.payload?.data?.inserted, 3);
  const importedStationBalance = (await call<Array<{ stationName: string; modelName: string; newQuantity: number; serviceableQuantity: number; defectiveQuantity: number; inRepairQuantity: number }>>('/material-management/station/balances', { cookie: admin })).payload?.data
    ?.find((row) => row.stationName === '일괄등록국사' && row.modelName === 'BULK-STATION-01');
  assert.deepEqual(importedStationBalance && [importedStationBalance.newQuantity, importedStationBalance.serviceableQuantity, importedStationBalance.defectiveQuantity, importedStationBalance.inRepairQuantity], [2, 3, 1, 0]);
  const repeatedStationImport = await call<{ inserted: number; skipped: number }>('/material-management/station/imports/inventory', { method: 'POST', cookie: admin, body: stationImportBody });
  assert.equal(repeatedStationImport.response.status, 201);
  assert.equal(repeatedStationImport.payload?.data?.inserted, 0);
  const decimalStationImport = await call('/material-management/station/imports/inventory', { method: 'POST', cookie: admin, body: {
    ...stationImportBody,
    sourceHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    rows: [{ ...stationImportBody.rows[0], newQuantity: 1.5 }],
  } });
  assert.equal(decimalStationImport.response.status, 409);

  assert.equal((await call('/material-management/field/transactions', { method: 'POST', cookie: guest, body: usageBody })).response.status, 403);
  const staged = await call<{ inserted: number; review: number }>('/material-management/imports/stage', { method: 'POST', cookie: admin, body: { domain: 'STATION', sourceFile: '국사예비품.xlsx', rows: [{ sheetName: '국사별 예비품 현황', rowNumber: 5, 국사: '안성국사', 모델명: 'GX2-LM1000', 수량: 4, 비고: '신품_1, 양품_3' }, { sheetName: '국사별 예비품 현황', rowNumber: 6, 국사: '수지국사', 모델명: 'UEB390-1540', 수량: '' }] } });
  assert.equal(staged.response.status, 201);
  assert.equal(staged.payload?.data?.review, 2);

  const previousYear = Number(date.slice(0,4)) - 1;
  const historicalHsImport = await call<{inserted:number;skipped:number}>('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'구내증폭기 분출현황(H&S).xlsx',
    sourceHash:'abababababababababababababababababababababababababababababababab',
    reportYear:previousYear,
    rows:[{sheetName:'구내증폭기 분출현황(H&S)',rowNumber:30,transactionType:'HS_ISSUE',effectiveDate:`${previousYear}-09-04`,categoryName,modelName:'통합테스트 수동모델',quantity:1,address:'평택',workCategory:'H&S 분출',workDetails:'H&S 분출내역 업로드',companyName:'H&S',unit:'EA'}],
  }});
  assert.equal(historicalHsImport.response.status,201);
  assert.equal(historicalHsImport.payload?.data?.inserted,1);

  const official = await file(`/material-management/exports/field-official.xlsx?year=${date.slice(0, 4)}`, admin);
  assert.equal(official.response.status, 200); assert.equal(official.body.subarray(0, 2).toString(), 'PK');
  assert.match(official.response.headers.get('cache-control') || '', /no-store/);
  assert.equal((await file(`/material-management/exports/station.xlsx?asOf=${date}`,manager)).response.status,403);
  assert.equal((await file(`/material-management/exports/station.xlsx?asOf=${date}`,teamLeader)).response.status,403);
  assert.equal((await file(`/material-management/exports/station.xlsx?asOf=${date}`,publicOfficial)).response.status,200);
  const officialWorkbook = new ExcelJS.Workbook(); await officialWorkbook.xlsx.load(official.body);
  const officialSummary = officialWorkbook.getWorksheet('사급자재 사용내역');
  assert.ok(officialSummary);
  assert.equal(officialSummary.getCell('B3').value, '자재명');
  assert.equal(officialSummary.getCell('BD3').value, '비고');
  assert.equal(officialSummary.getCell('B4').value, 'ONU');
  assert.equal(officialSummary.getCell('C4').value, 'SA - GM ONU(3PORT) DFB 1*1');
  assert.equal(officialSummary.getCell('D4').value, 'EA');
  assert.equal(officialSummary.getCell('C49').value, null);
  assert.equal(officialSummary.getCell('E49').value, null);
  assert.equal(officialSummary.getCell('BD49').value, null);
  assert.equal(officialSummary.getColumn('C').values.includes('통합테스트 수동모델'), true);
  const addedPassiveRow = officialSummary.getColumn('C').values.findIndex((value)=>value==='통합테스트 수동모델');
  assert.ok(addedPassiveRow >= 4);
  assert.equal(officialSummary.getRow(addedPassiveRow).getCell(2).value, categoryName);
  assert.equal(officialSummary.getColumn('C').values.includes('폐기모델-요약시트없음'), false);
  assert.equal(officialSummary.getCell('B68').value, '수동소자(옥외용)');
  assert.equal(officialSummary.getCell('B80').value, '수동소자(옥내용)');
  assert.ok(officialSummary.model.merges.includes('B68:B79'));
  assert.ok(officialSummary.model.merges.includes('B80:B84'));
  assert.equal(officialSummary.model.merges.includes('B68:B84'), false);
  const officialArchive = unzipSync(official.body);
  assert.equal(strFromU8(officialArchive['xl/workbook.xml']).includes('<definedNames>'), false);
  const summaryView = officialSummary.views[0] as { xSplit?: number; ySplit?: number };
  assert.equal(summaryView.xSplit, 12); assert.equal(summaryView.ySplit, 3);
  assert.equal(officialWorkbook.worksheets.filter((sheet) => /^센터 자재 사용내역\(\d{2}월\)$/.test(sheet.name)).length, 12);
  const marchSheet = officialWorkbook.getWorksheet('센터 자재 사용내역(03월)');
  assert.deepEqual((marchSheet.getRow(6).values as ExcelJS.CellValue[]).slice(1, 11), ['NO', '주소(설치장소)', '작업일자', '사용장비', '규     격', '작업구분', '수량', '작업내용', '작업자', '협업사명']);
  assert.equal((marchSheet.getCell('G5').value as { formula: string }).formula, 'SUBTOTAL(3,G7:G555)');
  assert.equal(marchSheet.getCell('A6').font.name, '맑은 고딕');
  assert.equal(marchSheet.getCell('A6').fill.type, 'pattern');
  assert.equal((marchSheet.getCell('A6').fill as ExcelJS.FillPattern).fgColor.argb, 'FFB7DEE8');
  assert.ok(marchSheet.getCell('G7').numFmt.includes(';;'));
  let importedOfficialRow: ExcelJS.Row | undefined;
  marchSheet.eachRow((row) => { if (row.getCell(5).value === 'OFFICIAL-IMPORT-01') importedOfficialRow = row; });
  assert.ok(importedOfficialRow);
  const importedOfficialDate = importedOfficialRow.getCell(3).value;
  assert.ok(importedOfficialDate instanceof Date);
  assert.equal(importedOfficialDate.toISOString().slice(0,10), `${Number(reportYear)-1}-12-29`);
  assert.equal(importedOfficialRow.getCell(4).value, '공사성자재');
  assert.equal(importedOfficialRow.getCell(6).value, '교체');
  assert.equal(importedOfficialRow.getCell(9).value, '원본작업자');
  const currentMonthSheet=officialWorkbook.getWorksheet(`센터 자재 사용내역(${date.slice(5,7)}월)`);
  assert.ok(currentMonthSheet);
  const distributionRows:ExcelJS.Row[]=[];
  currentMonthSheet.eachRow((row)=>{if(row.getCell(5).value==='통합테스트 수동모델'&&row.getCell(6).value==='분출')distributionRows.push(row);});
  assert.equal(distributionRows.length,2);
  distributionRows.forEach((row)=>[4,5,6,9].forEach((column)=>assert.equal(row.getCell(column).font.color.argb,'FF000000')));
  const hsExport = await file(`/material-management/exports/hs.xlsx?start=${period}-01&end=${date}`, admin);
  assert.equal(hsExport.response.status, 200); assert.equal(hsExport.body.subarray(0, 2).toString(), 'PK');
  const hsWorkbook = new ExcelJS.Workbook(); await hsWorkbook.xlsx.load(hsExport.body);
  const hsSheet = hsWorkbook.getWorksheet('구내증폭기 분출현황(H&S)');
  assert.ok(hsSheet);
  assert.equal(hsSheet.getCell('B2').value, '■ 지점별 구내증폭기 불출현황');
  assert.equal(hsSheet.getCell('B15').value, '사업자');
  assert.equal(hsSheet.getCell('F15').value, '수량');
  assert.deepEqual(Array.from({length:6},(_,index)=>hsSheet.getCell(index+5,3).value),['용인남부','용인북부','평택','수원동부','수원서부','화성']);
  assert.equal(hsSheet.getCell('B16').value, 'H&S');
  assert.equal(hsSheet.getCell('C16').value, '수원동부');
  assert.equal(hsSheet.getCell('F16').value, 1);
  assert.ok(hsSheet.model.merges.includes('B3:B4'));
  assert.equal((hsSheet.views[0] as { ySplit?: number }).ySplit, 15);
  assert.match(hsExport.response.headers.get('cache-control') || '', /no-store/);
  const allHsExport = await file('/material-management/exports/hs.xlsx?scope=all', admin);
  assert.equal(allHsExport.response.status,200);
  const allHsWorkbook = new ExcelJS.Workbook(); await allHsWorkbook.xlsx.load(allHsExport.body);
  const allHsSheet = allHsWorkbook.getWorksheet('구내증폭기 분출현황(H&S)');
  assert.ok(allHsSheet);
  assert.equal(allHsSheet.getCell('F4').value,`${previousYear}년`);
  assert.equal(allHsSheet.getCell('G4').value,`${Number(date.slice(0,4))}년`);
  assert.equal((allHsSheet.getCell('F7').value as {result:number}).result,1);
  assert.equal((allHsSheet.getCell('G8').value as {result:number}).result,1);
  const historicalHsRows:ExcelJS.Row[]=[];
  allHsSheet.eachRow((row)=>{if(row.getCell(8).value instanceof Date&&(row.getCell(8).value as Date).toISOString().slice(0,10)===`${previousYear}-09-04`)historicalHsRows.push(row);});
  assert.equal(historicalHsRows.length,1);
  assert.equal(historicalHsRows[0].getCell(9).value,null);
  assert.equal((allHsSheet.getCell(`F${allHsSheet.rowCount}`).value as {result:number}).result,2);
  const photos = await file(`/material-management/exports/field-photos.xlsx?period=${period}&mode=current`, admin);
  assert.equal(photos.response.status, 200); assert.equal(photos.body.subarray(0, 2).toString(), 'PK');
  const photoWorkbook = new ExcelJS.Workbook(); await photoWorkbook.xlsx.load(photos.body);
  const photoSheet = photoWorkbook.getWorksheet('능동자재 사진자료');
  assert.equal(photoSheet.getCell('A1').value,`${Number(period.slice(5))}월 능동자재 사진자료`);
  assert.ok(photoSheet.model.merges.includes('A1:K1'));
  assert.deepEqual((photoSheet.getRow(2).values as ExcelJS.CellValue[]).slice(1), ['순번','일자','지역','품목','모델','수량','위치','작업자','작업내용','전 사진','후 사진']);
  assert.equal(photoSheet.getCell('A3').value, 1);
  assert.equal(photoSheet.getCell('C3').value, managerRegionName);
  assert.equal((photoSheet.getRow(2).values as ExcelJS.CellValue[]).includes('거래번호'), false);
  assert.equal(photoSheet.getImages().length, 2);
  assert.equal(photoSheet.getColumn(10).width, 27);
  assert.equal(photoSheet.getColumn(11).width, 27);
  assert.equal(photoSheet.getRow(3).height, 145.5);
  for (const image of photoSheet.getImages()) {
    const { tl, ext } = image.range as unknown as ExcelJS.ImagePosition;
    assert.ok(Math.abs((tl.col - Math.floor(tl.col)) - (4 / 194)) < 0.01);
    assert.ok(Math.abs((tl.row - Math.floor(tl.row)) - (4 / 194)) < 0.01);
    assert.equal(Math.round(ext.width), 186);
    assert.equal(Math.round(ext.height), 186);
  }
  const photoMedia = Object.entries(unzipSync(photos.body)).filter(([filePath]) => /^xl\/media\/[^/]+$/.test(filePath));
  assert.equal(photoMedia.length, 2);
  for (const [, media] of photoMedia) {
    const metadata = await sharp(Buffer.from(media)).metadata();
    assert.equal(metadata.width, 186);
    assert.equal(metadata.height, 186);
  }
  assert.equal((photoSheet.views[0] as { ySplit?: number }).ySplit,2);
  assert.equal(photoSheet.getCell('A3').border.bottom?.color?.argb, 'FF9AA8B5');
  assert.equal(photoSheet.getCell('A3').border.right?.color?.argb, 'FF9AA8B5');
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='EXPORTED'").get() as { count: number }).count), 2);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='EXPORTED' AND delete_after IS NOT NULL").get() as { count: number }).count),0);

  const preservedSource = new ExcelJS.Workbook();
  const preservedSummary = preservedSource.addWorksheet('사급자재 사용내역');
  preservedSummary.getCell('B3').value = '자재명';
  preservedSummary.getCell('C3').value = '규격';
  preservedSummary.getCell('D3').value = '단위';
  preservedSummary.getCell('B4').value = '공사성 자재';
  preservedSummary.getCell('C4').value = 'SOURCE-PRESERVE-01';
  preservedSummary.getCell('D4').value = 'EA';
  preservedSummary.getCell('E4').value = 10;
  preservedSummary.getCell('F4').value = 2;
  preservedSummary.getCell('I4').value = { formula: '(F4+BC4)-(G4+H4)', result: 2 };
  preservedSummary.getCell('J4').value = { formula: 'Y4', result: 1 };
  preservedSummary.getCell('K4').value = { formula: 'AN4', result: 5 };
  preservedSummary.getCell('L4').value = { formula: 'E4-J4+K4', result: 14 };
  preservedSummary.getCell('M4').value = 1;
  preservedSummary.getCell('Y4').value = { formula: 'SUM(M4:X4)', result: 1 };
  preservedSummary.getCell('AB4').value = 5;
  preservedSummary.getCell('AN4').value = { formula: 'SUM(AB4:AM4)', result: 5 };
  preservedSummary.getCell('BC4').value = { formula: 'SUM(AQ4:BB4)', result: 0 };
  for (let month = 1; month <= 12; month += 1) {
    const sheet = preservedSource.addWorksheet(`센터 자재 사용내역(${String(month).padStart(2, '0')}월)`);
    sheet.getCell('G5').value = { formula: 'SUBTOTAL(3,G7:G20)', result: month === 1 ? 1 : 0 };
    ['NO','주소(설치장소)','작업일자','사용장비','규     격','작업구분','수량','작업내용','작업자','협업사명']
      .forEach((value, index) => { sheet.getRow(6).getCell(index + 1).value = value; });
    if (month === 1) {
      [1,'수원시 원본로 1',new Date(`${reportYear}-01-05T12:00:00`),'공사성 자재','SOURCE-PRESERVE-01','교체',1,'원본 사용내역','원본작업자','CATV 사업부']
        .forEach((value, index) => { sheet.getRow(7).getCell(index + 1).value = value as ExcelJS.CellValue; });
      sheet.getCell('C7').numFmt = 'yyyy-mm-dd';
    }
  }
  let preservedSourceBuffer = Buffer.from(await preservedSource.xlsx.writeBuffer());
  const preservedFiles=unzipSync(preservedSourceBuffer);
  const preservedWorkbookXml=strFromU8(preservedFiles['xl/workbook.xml']).replace('</workbook>','<definedNames><definedName name="손상된_이름">#REF!</definedName></definedNames></workbook>');
  preservedFiles['xl/workbook.xml']=strToU8(preservedWorkbookXml);
  preservedSourceBuffer=Buffer.from(zipSync(preservedFiles,{level:6}));
  const preservedSourceHash = createHash('sha256').update(preservedSourceBuffer).digest('hex');
  const preservedImportRows = [
    {sheetName:'사급자재 사용내역',rowNumber:4,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:10,stockState:'NORMAL'},
    {sheetName:'사급자재 사용내역',rowNumber:4,transactionType:'OPENING',effectiveDate:`${reportYear}-01-01`,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:2,stockState:'BAD'},
    {sheetName:'사급자재 사용내역',rowNumber:4,transactionType:'RECEIPT',effectiveDate:`${reportYear}-01-01`,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:5,stockState:'NORMAL'},
    {sheetName:'센터 자재 사용내역(01월)',rowNumber:7,transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-05`,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:1,address:'수원시 원본로 1',workCategory:'교체',workDetails:'원본 사용내역',workerName:'원본작업자'},
    {sheetName:'사급자재 사용내역',rowNumber:4,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:14,stockState:'NORMAL',stocktakeTarget:true,stocktakeSourceColumn:'L'},
    {sheetName:'사급자재 사용내역',rowNumber:4,transactionType:'ADJUSTMENT',effectiveDate:date,categoryName:'공사성 자재',modelName:'SOURCE-PRESERVE-01',unit:'EA',quantity:2,stockState:'BAD',stocktakeTarget:true,stocktakeSourceColumn:'I'},
  ];
  assert.equal((await call('/material-management/field/imports/official',{method:'POST',cookie:admin,body:{
    sourceFile:'공식월간보고_원본보존.xlsx',sourceHash:preservedSourceHash,sourceWorkbookBase64:preservedSourceBuffer.toString('base64'),reportYear:Number(reportYear),rows:preservedImportRows,
  }})).response.status,201);
  assert.deepEqual((await file(`/material-management/exports/field-official.xlsx?year=${reportYear}`,admin)).body,preservedSourceBuffer);
  const preservedModel=db.prepare("SELECT id FROM field_material_models WHERE model_name='SOURCE-PRESERVE-01'").get() as {id:string};
  assert.equal((await call('/material-management/field/transactions',{method:'POST',cookie:admin,body:{transactionType:'RECEIPT',effectiveDate:`${reportYear}-01-20`,modelId:preservedModel.id,quantity:3,idempotencyKey:'source-preserve-receipt'}})).response.status,201);
  assert.equal((await call('/material-management/field/transactions',{method:'POST',cookie:admin,body:{transactionType:'FIELD_USE',effectiveDate:`${reportYear}-01-21`,modelId:preservedModel.id,quantity:1,purpose:'추가 사용내역',idempotencyKey:'source-preserve-use'}})).response.status,201);
  const preservedDownload=await file(`/material-management/exports/field-official.xlsx?year=${reportYear}`,admin);
  assert.equal(strFromU8(unzipSync(preservedDownload.body)['xl/workbook.xml']).includes('<definedNames>'),false);
  const preservedResult=new ExcelJS.Workbook();await preservedResult.xlsx.load(preservedDownload.body);
  const preservedResultSummary=preservedResult.getWorksheet('사급자재 사용내역');
  assert.equal(preservedResultSummary.getCell('E4').value,10);
  assert.equal(preservedResultSummary.getCell('F4').value,2);
  assert.equal((preservedResultSummary.getCell('J4').value as {result:number}).result,2);
  assert.equal((preservedResultSummary.getCell('K4').value as {result:number}).result,8);
  assert.equal((preservedResultSummary.getCell('L4').value as {result:number}).result,16);
  const preservedJanuary=preservedResult.getWorksheet('센터 자재 사용내역(01월)');
  assert.equal(preservedJanuary.getCell('E7').value,'SOURCE-PRESERVE-01');
  assert.equal((preservedJanuary.getCell('C7').value as Date).getDate(),5);
  assert.equal(preservedJanuary.getCell('E8').value,'SOURCE-PRESERVE-01');
  assert.equal((preservedJanuary.getCell('C8').value as Date).getDate(),21);
  assert.equal(preservedJanuary.getCell('H8').value,'추가 사용내역');
  for (const address of ['D7','F7','I7','D8','F8','I8']) {
    assert.notEqual(preservedJanuary.getCell(address).numFmt,'#,##0.##;-#,##0.##;;');
    assert.equal(preservedJanuary.getCell(address).font.color?.argb,'FF000000');
  }

  const stationExcel = await file(`/material-management/exports/station.xlsx?asOf=${date}`, admin);
  assert.equal(stationExcel.response.status, 200); assert.equal(stationExcel.body.subarray(0, 2).toString(), 'PK');
  const stationWorkbook = new ExcelJS.Workbook(); await stationWorkbook.xlsx.load(stationExcel.body);
  assert.deepEqual(stationWorkbook.worksheets.map((sheet) => sheet.name), ['국사별 현재고', '입출고 원장', '불량수리 현황', '모델목록']);
  assert.deepEqual((stationWorkbook.getWorksheet('국사별 현재고').getRow(1).values as ExcelJS.CellValue[]).slice(1), ['기준일', '권역', '국사', '제조사', '품목', '모델명', '신품', '양품', '불량', '수리중', '사용가능', '전체보유', '단위']);
  assert.equal((stationWorkbook.getWorksheet('입출고 원장').getRow(1).values as ExcelJS.CellValue[]).includes('거래번호'), false);
  assert.equal((stationWorkbook.getWorksheet('모델목록').getRow(1).values as ExcelJS.CellValue[]).includes('카드구분'), false);
  for (const sheet of stationWorkbook.worksheets) {
    assert.equal(sheet.getCell('A2').border.bottom?.color?.argb, 'FF9AA8B5');
    assert.equal(sheet.getCell('A2').border.right?.color?.argb, 'FF9AA8B5');
  }
  const closed = await call<{id:string}>('/material-management/field/closures', { method: 'POST', cookie: admin, body: { periodKey: period } });
  assert.equal(closed.response.status, 201);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='EXPORTED' AND delete_after IS NOT NULL").get() as { count: number }).count),2);
  const fixedDeleteAfter=String((db.prepare("SELECT delete_after AS deleteAfter FROM material_photo_assets WHERE archive_status='EXPORTED' LIMIT 1").get() as {deleteAfter:string}).deleteAfter);
  const closedPhotos=await file(`/material-management/exports/field-photos.xlsx?period=${period}&mode=closed`,admin);
  assert.equal(closedPhotos.response.status,200);
  assert.equal(String((db.prepare("SELECT delete_after AS deleteAfter FROM material_photo_assets WHERE archive_status='EXPORTED' LIMIT 1").get() as {deleteAfter:string}).deleteAfter),fixedDeleteAfter);
  const cancelled=await call(`/material-management/field/closures/${closed.payload?.data?.id}/cancel`,{method:'POST',cookie:admin,body:{reason:'마감자료 재확인'}});
  assert.equal(cancelled.response.status,200);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='EXPORTED' AND delete_after IS NOT NULL").get() as {count:number}).count),0);
  const reclosed=await call('/material-management/field/closures',{method:'POST',cookie:admin,body:{periodKey:period}});
  assert.equal(reclosed.response.status,201);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='EXPORTED' AND delete_after IS NOT NULL").get() as {count:number}).count),2);
  const blockedAfterClose = await call('/material-management/field/transactions', { method: 'POST', cookie: admin, body: { transactionType: 'RECEIPT', effectiveDate: date, modelId: passiveId, quantity: 1, idempotencyKey: 'closed-period' } });
  assert.equal(blockedAfterClose.response.status, 409); assert.equal(blockedAfterClose.payload?.code, 'PERIOD_CLOSED');
  db.prepare("UPDATE material_photo_assets SET delete_after=datetime('now','-1 minute') WHERE archive_status='EXPORTED'").run();
  const retentionPurge=await call<{purged:number;failed:number}>('/material-management/photos/purge-expired',{method:'POST',cookie:admin});
  assert.equal(retentionPurge.response.status,200);
  assert.equal(retentionPurge.payload?.data?.purged,2);
  assert.equal(retentionPurge.payload?.data?.failed,0);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE archive_status='DELETED' AND deleted_at IS NOT NULL").get() as {count:number}).count),4);
  assert.ok(Number((db.prepare('SELECT COUNT(*) AS count FROM inventory_audit_logs').get() as { count: number }).count) >= 9);
  console.log('inventory management tests passed');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
