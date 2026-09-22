import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { db } from './db';
import { ApiError, asPositiveInteger, asPositiveNumber, asText, optionalText } from './http';
import { authUser, type AuthUser, type DbRole } from './security/session';
import { normalizeStationName } from './catv';
import { purgeMaterialTransactionPhotos } from './material-photo-retention';

export type InventoryDomain = 'FIELD' | 'STATION';
export type FieldStockState = 'NORMAL' | 'BAD';
export type SpareStockState = 'NEW' | 'SERVICEABLE' | 'DEFECTIVE' | 'IN_REPAIR';

export const elevatedRoles = new Set<DbRole>(['admin', 'public_official']);
export const fieldWorkerTypes = new Set(['FIELD_USE', 'RECOVERED_GOOD', 'RECOVERED_BAD']);
export const stationWorkerTypes = new Set(['USE', 'DEFECT_CONVERSION', 'RECOVERED_DEFECTIVE']);

const fieldTypes = new Set([
  'OPENING', 'RECEIPT', 'FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE',
  'RECOVERED_GOOD', 'RECOVERED_BAD', 'REPAIR_OUT', 'DISPOSAL', 'ADJUSTMENT', 'REVERSAL',
]);
const stationTypes = new Set([
  'OPENING', 'RECEIPT', 'USE', 'DEFECT_CONVERSION', 'REPAIR_OUT',
  'RECOVERED_DEFECTIVE', 'REPAIR_COMPLETE', 'REPAIR_UNREPAIRABLE', 'DISPOSAL', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL',
]);

export type AssignableFieldWorker = {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
};

export const listAssignableFieldWorkers = (user: AuthUser) => {
  const workers = db.prepare(`
    SELECT u.id,u.name,u.region_id AS regionId,r.region_name AS regionName
      FROM users u
      LEFT JOIN regions r ON r.id=u.region_id
     WHERE u.status='active' AND u.deleted_at IS NULL
       AND COALESCE(u.access_role,CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END)='manager'
     ORDER BY COALESCE(r.sort_order,999),u.name
  `).all() as AssignableFieldWorker[];
  if (user.role === 'manager') return workers.filter((worker) => worker.id === user.id);
  if (user.role === 'team_leader') return workers.filter((worker) => Boolean(user.regionId) && worker.regionId === user.regionId);
  if (user.role === 'admin' || user.role === 'public_official') return workers;
  return [];
};

const resolveFieldWorkerName = (user: AuthUser, requestedWorkerId: unknown) => {
  const workers = listAssignableFieldWorkers(user);
  const workerId = user.role === 'manager' ? user.id : optionalText(requestedWorkerId, 100) || workers[0]?.id;
  const worker = workers.find((item) => item.id === workerId);
  if (!worker) throw new ApiError(403, '선택할 수 없는 작업자입니다.', 'WORKER_SCOPE_FORBIDDEN');
  return worker.name;
};

const asDate = (value: unknown, label: string) => {
  const date = asText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ApiError(400, `${label} 형식은 YYYY-MM-DD여야 합니다.`, 'VALIDATION_ERROR');
  }
  return date;
};

const transactionNumber = (domain: InventoryDomain) => {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${domain === 'FIELD' ? 'FM' : 'SP'}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
};

const assertRole = (user: AuthUser, domain: InventoryDomain, type: string) => {
  if (user.role === 'guest') throw new ApiError(403, '조회 전용 계정은 등록할 수 없습니다.', 'GUEST_READ_ONLY');
  if (elevatedRoles.has(user.role)) return;
  const allowed = domain === 'FIELD' ? fieldWorkerTypes : stationWorkerTypes;
  if (!allowed.has(type)) throw new ApiError(403, '이 거래를 등록할 권한이 없습니다.', 'FORBIDDEN');
};

export const fieldBalance = (modelId: string, state: FieldStockState, asOf?: string) => Number((db.prepare(`
  SELECT COALESCE(SUM(e.signed_quantity), 0) AS quantity
    FROM field_material_entries e
    JOIN inventory_transactions t ON t.id = e.transaction_id
   WHERE e.model_id = ? AND e.stock_state = ? AND t.status = 'POSTED'
     ${asOf ? 'AND t.effective_date <= ?' : ''}
`).get(...(asOf ? [modelId, state, asOf] : [modelId, state])) as { quantity: number }).quantity);

const fieldOpeningBalance = (modelId: string, state: FieldStockState, asOf: string) => Number((db.prepare(`
  SELECT COALESCE(SUM(e.signed_quantity),0) AS quantity
    FROM field_material_entries e JOIN inventory_transactions t ON t.id=e.transaction_id
   WHERE e.model_id=? AND e.stock_state=? AND t.status='POSTED' AND t.transaction_type='OPENING' AND t.effective_date<=?
`).get(modelId,state,asOf) as {quantity:number}).quantity);

export const spareBalance = (stationId: string, modelId: string, state: SpareStockState, asOf?: string) => Number((db.prepare(`
  SELECT COALESCE(SUM(e.signed_quantity), 0) AS quantity
    FROM spare_entries e
    JOIN inventory_transactions t ON t.id = e.transaction_id
   WHERE e.station_id = ? AND e.model_id = ? AND e.stock_state = ? AND t.status = 'POSTED'
     ${asOf ? 'AND t.effective_date <= ?' : ''}
`).get(...(asOf ? [stationId, modelId, state, asOf] : [stationId, modelId, state])) as { quantity: number }).quantity);

const assertOpenPeriod = (effectiveDate: string) => {
  const closed = db.prepare(`
    SELECT period_key FROM inventory_month_closures
     WHERE status = 'CLOSED' AND ? BETWEEN period_start AND period_end
  `).get(effectiveDate) as { period_key: string } | undefined;
  if (closed) throw new ApiError(409, `${closed.period_key} 마감기간에는 거래를 추가할 수 없습니다.`, 'PERIOD_CLOSED');
};

const inferredRegionName = (address: string) => {
  if (/평택|안성/.test(address)) return '평택안성';
  if (/용인|수지|기흥|처인/.test(address)) return '용인';
  if (/수원/.test(address)) return '수원';
  if (/오산|화성/.test(address)) return '오산화성';
  return null;
};

export const resolveFieldRegionId = (address: string, requestedRegionId?: string | null) => {
  if (requestedRegionId) {
    const requested = db.prepare('SELECT id FROM regions WHERE id=? AND active=1').get(requestedRegionId) as { id: string } | undefined;
    if (requested) return requested.id;
  }
  const name = inferredRegionName(address);
  if (!name) return null;
  return (db.prepare('SELECT id FROM regions WHERE region_name=? AND active=1').get(name) as { id: string } | undefined)?.id || null;
};

const scopedFieldRegion = (user: AuthUser, address: string, requestedRegionId?: string | null) => {
  const resolved = resolveFieldRegionId(address, requestedRegionId);
  if (!['manager', 'team_leader'].includes(user.role)) return resolved;
  if (!user.regionId) throw new ApiError(409, '사용자에게 담당지역이 지정되어 있지 않습니다.', 'USER_REGION_REQUIRED');
  if (resolved && resolved !== user.regionId) throw new ApiError(403, '담당지역의 자재내역만 등록할 수 있습니다.', 'REGION_SCOPE_FORBIDDEN');
  return user.regionId;
};

const existingIdempotentTransaction = (userId: string, key: string | null) => {
  if (!key) return null;
  return db.prepare('SELECT id FROM inventory_transactions WHERE created_by = ? AND idempotency_key = ?')
    .get(userId, key) as { id: string } | undefined;
};

const insertAudit = (
  transactionId: string,
  user: AuthUser,
  action: string,
  reason: string | null,
  after: Record<string, unknown>,
  requestId: string | null,
) => {
  db.prepare(`
    INSERT INTO inventory_audit_logs (id, transaction_id, user_id, role, action, reason, after_json, request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), transactionId, user.id, user.role, action, reason, JSON.stringify(after), requestId);
};

const baseInput = (req: Request, domain: InventoryDomain) => {
  const user = authUser(req);
  const type = asText(req.body?.transactionType, '거래유형', 50).toUpperCase();
  if (!(domain === 'FIELD' ? fieldTypes : stationTypes).has(type)) {
    throw new ApiError(400, '지원하지 않는 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
  }
  assertRole(user, domain, type);
  const effectiveDate = asDate(req.body?.effectiveDate, '거래일자');
  if (!['OPENING', 'ADJUSTMENT', 'REVERSAL'].includes(type)) assertOpenPeriod(effectiveDate);
  const idempotencyKey = optionalText(req.body?.idempotencyKey, 100);
  const existing = existingIdempotentTransaction(user.id, idempotencyKey);
  return { user, type, effectiveDate, idempotencyKey, existing };
};

export type SavedPhotoInput = {
  id: string;
  slot: 'BEFORE' | 'AFTER';
  objectKey: string;
  thumbnailObjectKey: string;
  mimeType: string;
  size: number;
  thumbnailSize: number;
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  sha256: string;
  thumbnailSha256: string;
};

export const createFieldTransaction = (req: Request, photos: SavedPhotoInput[] = [], requestedId?: string, manageTransaction = true) => {
  const input = baseInput(req, 'FIELD');
  if (input.existing) return getTransaction(input.existing.id);
  if (['FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE'].includes(input.type)) {
    asText(req.body?.purpose, '사용내용', 1000);
  }
  if (['REPAIR_OUT', 'DISPOSAL', 'ADJUSTMENT'].includes(input.type)) {
    asText(req.body?.reason || req.body?.purpose, '처리사유', 1000);
  }
  const modelId = asText(req.body?.modelId, '세부모델', 100);
  const quantity = asPositiveInteger(req.body?.quantity, '수량');
  const model = db.prepare(`
    SELECT m.*, c.category_name FROM field_material_models m
    JOIN field_material_categories c ON c.id = m.category_id
    WHERE m.id = ? AND m.active = 1 AND c.active = 1
  `).get(modelId) as Record<string, unknown> | undefined;
  if (!model) throw new ApiError(404, '사용 가능한 현장 자재 모델을 찾을 수 없습니다.', 'MODEL_NOT_FOUND');
  if (input.type === 'FIELD_USE' && String(model.material_kind) === 'ACTIVE') {
    if (photos.length !== 2 || !photos.some((p) => p.slot === 'BEFORE') || !photos.some((p) => p.slot === 'AFTER')) {
      throw new ApiError(400, '능동자재 현장사용에는 전·후 사진이 각각 1장 필요합니다.', 'ACTIVE_PHOTOS_REQUIRED');
    }
    if (photos[0].sha256 === photos[1].sha256) throw new ApiError(400, '전·후 사진은 서로 다른 사진이어야 합니다.', 'DUPLICATE_PHOTO');
  }

  const entries: Array<{ state: FieldStockState; delta: number }> = [];
  const requestedState = String(req.body?.stockState || 'NORMAL').toUpperCase() as FieldStockState;
  if (!['NORMAL', 'BAD'].includes(requestedState)) throw new ApiError(400, '재고상태가 올바르지 않습니다.', 'INVALID_STOCK_STATE');
  switch (input.type) {
    case 'OPENING':
    case 'ADJUSTMENT': entries.push({ state: requestedState, delta: Number(req.body?.direction || 1) < 0 ? -quantity : quantity }); break;
    case 'RECEIPT':
    case 'RECOVERED_GOOD': entries.push({ state: 'NORMAL', delta: quantity }); break;
    case 'RECOVERED_BAD': entries.push({ state: 'BAD', delta: quantity }); break;
    case 'FIELD_USE':
    case 'OTHER_COMPANY_ISSUE':
    case 'HS_ISSUE': entries.push({ state: 'NORMAL', delta: -quantity }); break;
    case 'REPAIR_OUT':
    case 'DISPOSAL': entries.push({ state: 'BAD', delta: -quantity }); break;
    default: throw new ApiError(400, '이 경로에서 처리할 수 없는 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
  }
  for (const entry of entries) {
    if (entry.delta < 0 && fieldBalance(modelId, entry.state) + entry.delta < 0) {
      throw new ApiError(409, `${entry.state === 'NORMAL' ? '정상' : '불량'}재고가 부족합니다.`, 'INSUFFICIENT_STOCK');
    }
  }

  const id = requestedId || randomUUID();
  const number = transactionNumber('FIELD');
  const location = optionalText(req.body?.location || req.body?.address, 300) || '';
  const regionId = scopedFieldRegion(input.user, location, optionalText(req.body?.regionId, 100));
  const sourceWorkerName = resolveFieldWorkerName(input.user, req.body?.sourceWorkerId);
  if (manageTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of entries) {
      if (entry.delta < 0 && fieldBalance(modelId, entry.state) + entry.delta < 0) {
        throw new ApiError(409, '동시 처리 중 재고가 변경되었습니다. 다시 확인해주세요.', 'INSUFFICIENT_STOCK');
      }
    }
    db.prepare(`
      INSERT INTO inventory_transactions (
        id, transaction_number, domain, transaction_type, effective_date, created_by,
        region_id, cell_id, work_id, company_name, source_worker_name, work_category, location_text, purpose, work_details,
        memo, reason, idempotency_key
      ) VALUES (?, ?, 'FIELD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, number, input.type, input.effectiveDate, input.user.id,
      regionId, optionalText(req.body?.cellId, 100), optionalText(req.body?.workId, 100),
      optionalText(req.body?.companyName, 200), sourceWorkerName, optionalText(req.body?.workCategory, 50), location,
      optionalText(req.body?.purpose, 1000), optionalText(req.body?.workDetails, 3000),
      optionalText(req.body?.memo, 2000), optionalText(req.body?.reason, 1000), input.idempotencyKey,
    );
    const insertEntry = db.prepare(`
      INSERT INTO field_material_entries (
        id, transaction_id, model_id, stock_state, signed_quantity, unit_snapshot, model_name_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    entries.forEach((entry) => insertEntry.run(randomUUID(), id, modelId, entry.state, entry.delta, String(model.unit), String(model.model_name)));
    const insertPhoto = db.prepare(`
      INSERT INTO material_photo_assets (
        id, transaction_id, photo_slot, object_key, thumbnail_object_key,
        mime_type, file_size, thumbnail_size, width, height, thumbnail_width, thumbnail_height,
        sha256, thumbnail_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    photos.forEach((photo) => insertPhoto.run(photo.id, id, photo.slot, photo.objectKey, photo.thumbnailObjectKey,
      photo.mimeType, photo.size, photo.thumbnailSize, photo.width, photo.height,
      photo.thumbnailWidth, photo.thumbnailHeight, photo.sha256, photo.thumbnailSha256));
    insertAudit(id, input.user, 'INVENTORY_TRANSACTION_CREATED', optionalText(req.body?.reason, 1000), {
      domain: 'FIELD', transactionType: input.type, modelId, quantity, entries,
    }, input.idempotencyKey);
    if (manageTransaction) db.exec('COMMIT');
  } catch (error) {
    if (manageTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return getTransaction(id);
};

export const createStationTransaction = (req: Request, manageTransaction = true) => {
  const input = baseInput(req, 'STATION');
  if (input.existing) return getTransaction(input.existing.id);
  if (['USE', 'RECOVERED_DEFECTIVE', 'REPAIR_COMPLETE', 'REPAIR_UNREPAIRABLE', 'DISPOSAL', 'TRANSFER', 'ADJUSTMENT'].includes(input.type)) {
    asText(req.body?.purpose || req.body?.reason, '처리내용', 1000);
  }
  if (input.type === 'DEFECT_CONVERSION') asText(req.body?.workDetails, '불량증상', 3000);
  if (input.type === 'REPAIR_OUT') {
    asText(req.body?.vendorName || req.body?.companyName, '수리업체', 200);
    asText(req.body?.workDetails, '고장내용', 3000);
  }
  const modelId = asText(req.body?.modelId, '모델', 100);
  const stationId = asText(req.body?.stationId || req.body?.sourceStationId, '국사', 100);
  const quantity = asPositiveInteger(req.body?.quantity, '수량');
  const model = db.prepare('SELECT * FROM spare_models WHERE id = ? AND active = 1').get(modelId) as Record<string, unknown> | undefined;
  const station = db.prepare('SELECT * FROM spare_stations WHERE id = ? AND active = 1').get(stationId) as Record<string, unknown> | undefined;
  if (!model || !station) throw new ApiError(404, '사용 가능한 국사 또는 모델을 찾을 수 없습니다.', 'MASTER_NOT_FOUND');
  const state = String(req.body?.stockState || 'SERVICEABLE').toUpperCase() as SpareStockState;
  if (!['NEW', 'SERVICEABLE', 'DEFECTIVE', 'IN_REPAIR'].includes(state)) throw new ApiError(400, '재고상태가 올바르지 않습니다.', 'INVALID_STOCK_STATE');
  const fromState = String(req.body?.fromState || state).toUpperCase() as SpareStockState;
  const entries: Array<{ stationId: string; state: SpareStockState; delta: number }> = [];
  let destinationStationId: string | null = null;
  let repairCase: { id: string; outbound_quantity: number; resolved_quantity: number } | null = null;
  if (['REPAIR_COMPLETE', 'REPAIR_UNREPAIRABLE'].includes(input.type)) {
    repairCase = db.prepare(`
      SELECT id, outbound_quantity, resolved_quantity FROM spare_repair_cases
       WHERE station_id=? AND model_id=? AND status IN ('OPEN','PARTIAL')
       ORDER BY created_at LIMIT 1
    `).get(stationId, modelId) as typeof repairCase;
    if (!repairCase || repairCase.outbound_quantity - repairCase.resolved_quantity < quantity) {
      throw new ApiError(409, '처리 가능한 수리출고 수량이 부족합니다.', 'REPAIR_CASE_QUANTITY_EXCEEDED');
    }
  }
  switch (input.type) {
    case 'OPENING':
    case 'ADJUSTMENT': entries.push({ stationId, state, delta: Number(req.body?.direction || 1) < 0 ? -quantity : quantity }); break;
    case 'RECEIPT': entries.push({ stationId, state, delta: quantity }); break;
    case 'USE': entries.push({ stationId, state, delta: -quantity }); break;
    case 'RECOVERED_DEFECTIVE': entries.push({ stationId, state: 'DEFECTIVE', delta: quantity }); break;
    case 'DEFECT_CONVERSION':
      if (!['NEW', 'SERVICEABLE'].includes(fromState)) throw new ApiError(400, '신품 또는 양품만 불량으로 전환할 수 있습니다.', 'INVALID_STOCK_STATE');
      entries.push({ stationId, state: fromState, delta: -quantity }, { stationId, state: 'DEFECTIVE', delta: quantity });
      break;
    case 'REPAIR_OUT': entries.push({ stationId, state: 'DEFECTIVE', delta: -quantity }, { stationId, state: 'IN_REPAIR', delta: quantity }); break;
    case 'REPAIR_COMPLETE': entries.push({ stationId, state: 'IN_REPAIR', delta: -quantity }, { stationId, state: 'SERVICEABLE', delta: quantity }); break;
    case 'REPAIR_UNREPAIRABLE':
      entries.push({ stationId, state: 'IN_REPAIR', delta: -quantity }, { stationId, state: 'DEFECTIVE', delta: quantity });
      break;
    case 'DISPOSAL': entries.push({ stationId, state: 'DEFECTIVE', delta: -quantity }); break;
    case 'TRANSFER': {
      destinationStationId = asText(req.body?.destinationStationId, '도착 국사', 100);
      if (destinationStationId === stationId) throw new ApiError(400, '출발 국사와 도착 국사는 달라야 합니다.', 'SAME_STATION');
      const destination = db.prepare('SELECT id FROM spare_stations WHERE id = ? AND active = 1').get(destinationStationId);
      if (!destination) throw new ApiError(404, '도착 국사를 찾을 수 없습니다.', 'STATION_NOT_FOUND');
      entries.push({ stationId, state, delta: -quantity }, { stationId: destinationStationId, state, delta: quantity });
      break;
    }
    default: throw new ApiError(400, '이 경로에서 처리할 수 없는 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
  }
  for (const entry of entries) {
    if (entry.delta < 0 && spareBalance(entry.stationId, modelId, entry.state) + entry.delta < 0) {
      throw new ApiError(409, '선택한 국사·상태의 재고가 부족합니다.', 'INSUFFICIENT_STOCK');
    }
  }
  const id = randomUUID();
  const number = transactionNumber('STATION');
  if (manageTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of entries) {
      if (entry.delta < 0 && spareBalance(entry.stationId, modelId, entry.state) + entry.delta < 0) {
        throw new ApiError(409, '동시 처리 중 재고가 변경되었습니다. 다시 확인해주세요.', 'INSUFFICIENT_STOCK');
      }
    }
    db.prepare(`
      INSERT INTO inventory_transactions (
        id, transaction_number, domain, transaction_type, effective_date, created_by,
        source_station_id, destination_station_id, company_name, location_text, purpose,
        work_details, memo, reason, idempotency_key
      ) VALUES (?, ?, 'STATION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, number, input.type, input.effectiveDate, input.user.id, stationId, destinationStationId,
      optionalText(req.body?.companyName || req.body?.vendorName, 200), optionalText(req.body?.location, 300),
      optionalText(req.body?.purpose, 1000), optionalText(req.body?.workDetails, 3000),
      optionalText(req.body?.memo, 2000), optionalText(req.body?.reason, 1000), input.idempotencyKey,
    );
    const insertEntry = db.prepare(`
      INSERT INTO spare_entries (
        id, transaction_id, station_id, model_id, stock_state, signed_quantity, unit_snapshot, model_name_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    entries.forEach((entry) => insertEntry.run(randomUUID(), id, entry.stationId, modelId, entry.state, entry.delta, String(model.unit), String(model.model_name)));
    if (input.type === 'REPAIR_OUT') {
      db.prepare(`
        INSERT INTO spare_repair_cases (
          id, model_id, station_id, outbound_transaction_id, outbound_quantity, vendor_name, fault_details
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), modelId, stationId, id, quantity, optionalText(req.body?.vendorName, 200), optionalText(req.body?.workDetails, 3000));
    }
    if (repairCase) {
      const resolved = repairCase.resolved_quantity + quantity;
      db.prepare(`
        UPDATE spare_repair_cases SET resolved_quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(resolved, resolved >= repairCase.outbound_quantity ? 'CLOSED' : 'PARTIAL', repairCase.id);
    }
    insertAudit(id, input.user, 'INVENTORY_TRANSACTION_CREATED', optionalText(req.body?.reason, 1000), {
      domain: 'STATION', transactionType: input.type, modelId, quantity, entries,
    }, input.idempotencyKey);
    if (manageTransaction) db.exec('COMMIT');
  } catch (error) {
    if (manageTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return getTransaction(id);
};

export const getTransaction = (id: string) => {
  const row = db.prepare(`
    SELECT t.*, u.name AS created_by_name,
           ss.station_name AS source_station_name, ds.station_name AS destination_station_name
      FROM inventory_transactions t
      JOIN users u ON u.id = t.created_by
      LEFT JOIN spare_stations ss ON ss.id = t.source_station_id
      LEFT JOIN spare_stations ds ON ds.id = t.destination_station_id
     WHERE t.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, '재고 거래를 찾을 수 없습니다.', 'TRANSACTION_NOT_FOUND');
  const entries = row.domain === 'FIELD'
    ? db.prepare(`SELECT e.*, m.model_name, c.category_name FROM field_material_entries e JOIN field_material_models m ON m.id=e.model_id JOIN field_material_categories c ON c.id=m.category_id WHERE e.transaction_id=?`).all(id)
    : db.prepare(`SELECT e.*, m.model_name, m.manufacturer, m.item_type, s.station_name, s.region_name FROM spare_entries e JOIN spare_models m ON m.id=e.model_id JOIN spare_stations s ON s.id=e.station_id WHERE e.transaction_id=?`).all(id);
  const photos = row.domain === 'FIELD' ? db.prepare('SELECT id, photo_slot, object_key, mime_type, file_size, width, height, sha256, archive_status FROM material_photo_assets WHERE transaction_id = ? ORDER BY photo_slot').all(id) : [];
  return { ...row, entries, photos };
};

export const reverseTransaction = (req: Request) => {
  const user = authUser(req);
  if (!elevatedRoles.has(user.role)) throw new ApiError(403, '거래 취소 권한이 없습니다.', 'FORBIDDEN');
  const original = db.prepare("SELECT * FROM inventory_transactions WHERE id = ? AND status = 'POSTED'").get(req.params.id) as Record<string, unknown> | undefined;
  if (!original) throw new ApiError(404, '취소 가능한 거래를 찾을 수 없습니다.', 'TRANSACTION_NOT_FOUND');
  if (original.transaction_type === 'REVERSAL') throw new ApiError(409, '역분개 거래는 다시 취소할 수 없습니다.', 'INVALID_REVERSAL');
  const reason = asText(req.body?.reason, '취소사유', 1000);
  assertOpenPeriod(new Date().toISOString().slice(0, 10));
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO inventory_transactions (
        id, transaction_number, domain, transaction_type, effective_date, created_by,
        region_id, cell_id, source_station_id, destination_station_id, reason, original_transaction_id
      ) VALUES (?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, transactionNumber(String(original.domain) as InventoryDomain), String(original.domain), new Date().toISOString().slice(0, 10), user.id,
      original.region_id == null ? null : String(original.region_id), original.cell_id == null ? null : String(original.cell_id),
      original.source_station_id == null ? null : String(original.source_station_id), original.destination_station_id == null ? null : String(original.destination_station_id), reason, String(original.id));
    if (original.domain === 'FIELD') {
      const entries = db.prepare('SELECT * FROM field_material_entries WHERE transaction_id = ?').all(String(original.id)) as Array<Record<string, unknown>>;
      const insert = db.prepare(`INSERT INTO field_material_entries (id, transaction_id, model_id, stock_state, signed_quantity, unit_snapshot, model_name_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      entries.forEach((entry) => {
        const state = String(entry.stock_state) as FieldStockState;
        const reverseDelta = -Number(entry.signed_quantity);
        if (reverseDelta < 0 && fieldBalance(String(entry.model_id), state) + reverseDelta < 0) {
          throw new ApiError(409, '취소하면 재고가 음수가 됩니다. 조정거래를 사용해주세요.', 'REVERSAL_WOULD_NEGATIVE');
        }
        insert.run(randomUUID(), id, String(entry.model_id), state, reverseDelta, String(entry.unit_snapshot), String(entry.model_name_snapshot));
      });
    } else {
      const entries = db.prepare('SELECT * FROM spare_entries WHERE transaction_id = ?').all(String(original.id)) as Array<Record<string, unknown>>;
      const insert = db.prepare(`INSERT INTO spare_entries (id, transaction_id, station_id, model_id, stock_state, signed_quantity, unit_snapshot, model_name_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      entries.forEach((entry) => {
        const state = String(entry.stock_state) as SpareStockState;
        const reverseDelta = -Number(entry.signed_quantity);
        if (reverseDelta < 0 && spareBalance(String(entry.station_id), String(entry.model_id), state) + reverseDelta < 0) {
          throw new ApiError(409, '취소하면 재고가 음수가 됩니다. 조정거래를 사용해주세요.', 'REVERSAL_WOULD_NEGATIVE');
        }
        insert.run(randomUUID(), id, String(entry.station_id), String(entry.model_id), state, reverseDelta, String(entry.unit_snapshot), String(entry.model_name_snapshot));
      });
    }
    db.prepare("UPDATE inventory_transactions SET status='REVERSED', reversed_at=CURRENT_TIMESTAMP WHERE id=?").run(String(original.id));
    insertAudit(id, user, 'INVENTORY_TRANSACTION_REVERSED', reason, { originalTransactionId: String(original.id) }, null);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getTransaction(id);
};

const editableFieldTypes = new Set([
  'OPENING', 'RECEIPT', 'FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE',
  'RECOVERED_GOOD', 'RECOVERED_BAD', 'REPAIR_OUT', 'DISPOSAL', 'ADJUSTMENT',
]);

const fieldMutationTarget = (req: Request) => {
  const user = authUser(req);
  if (!['admin', 'public_official', 'team_leader'].includes(user.role)) {
    throw new ApiError(403, '자재 사용이력 수정 권한이 없습니다.', 'FORBIDDEN');
  }
  const original = db.prepare(`
    SELECT * FROM inventory_transactions
     WHERE id=? AND domain='FIELD' AND status='POSTED' AND transaction_type<>'REVERSAL'
  `).get(req.params.id) as Record<string, unknown> | undefined;
  if (!original) throw new ApiError(404, '수정 가능한 자재내역을 찾을 수 없습니다.', 'TRANSACTION_NOT_FOUND');
  const originalAddress = String(original.location_text || '');
  const originalRegionId = original.region_id ? String(original.region_id) : resolveFieldRegionId(originalAddress);
  if (user.role === 'team_leader') {
    if (!user.regionId || originalRegionId !== user.regionId) {
      throw new ApiError(403, '팀장은 담당지역의 자재 사용이력만 수정할 수 있습니다.', 'REGION_SCOPE_FORBIDDEN');
    }
  }
  const entries = db.prepare('SELECT * FROM field_material_entries WHERE transaction_id=?').all(String(original.id)) as Array<Record<string, unknown>>;
  if (entries.length !== 1) throw new ApiError(409, '단일 자재 거래만 수정하거나 삭제할 수 있습니다.', 'UNSUPPORTED_TRANSACTION_EDIT');
  return { user, original, originalRegionId, entry: entries[0] };
};

const fieldEntryForEdit = (type: string, quantity: number, requestedState: string, direction: number) => {
  switch (type) {
    case 'OPENING': return { state: requestedState as FieldStockState, signed: quantity };
    case 'ADJUSTMENT': return { state: requestedState as FieldStockState, signed: direction < 0 ? -quantity : quantity };
    case 'RECEIPT':
    case 'RECOVERED_GOOD': return { state: 'NORMAL' as FieldStockState, signed: quantity };
    case 'RECOVERED_BAD': return { state: 'BAD' as FieldStockState, signed: quantity };
    case 'FIELD_USE':
    case 'OTHER_COMPANY_ISSUE':
    case 'HS_ISSUE': return { state: 'NORMAL' as FieldStockState, signed: -quantity };
    case 'REPAIR_OUT':
    case 'DISPOSAL': return { state: 'BAD' as FieldStockState, signed: -quantity };
    default: throw new ApiError(400, '수정할 수 없는 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
  }
};

const assertFieldReplacementStock = (
  oldEntry: Record<string, unknown>,
  replacement?: { modelId: string; state: FieldStockState; signed: number },
) => {
  const oldModelId = String(oldEntry.model_id);
  const oldState = String(oldEntry.stock_state) as FieldStockState;
  const oldSigned = Number(oldEntry.signed_quantity);
  const keys = new Set([`${oldModelId}\u0000${oldState}`]);
  if (replacement) keys.add(`${replacement.modelId}\u0000${replacement.state}`);
  for (const key of keys) {
    const [modelId, state] = key.split('\u0000') as [string, FieldStockState];
    let projected = fieldBalance(modelId, state);
    if (modelId === oldModelId && state === oldState) projected -= oldSigned;
    if (replacement && modelId === replacement.modelId && state === replacement.state) projected += replacement.signed;
    if (projected < 0) throw new ApiError(409, '수정 또는 삭제하면 재고가 부족해집니다.', 'INSUFFICIENT_STOCK');
  }
};

export const updateFieldTransaction = (req: Request) => {
  const { user, original, originalRegionId, entry: oldEntry } = fieldMutationTarget(req);
  const type = String(req.body?.transactionType || original.transaction_type).toUpperCase();
  if (!editableFieldTypes.has(type)) throw new ApiError(400, '수정할 수 없는 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
  const effectiveDate = req.body?.effectiveDate ? asDate(req.body.effectiveDate, '거래일자') : String(original.effective_date);
  assertOpenPeriod(String(original.effective_date));
  if (effectiveDate !== original.effective_date) assertOpenPeriod(effectiveDate);
  const modelId = req.body?.modelId ? asText(req.body.modelId, '세부모델', 100) : String(oldEntry.model_id);
  const model = db.prepare(`SELECT m.*, c.category_name FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id WHERE m.id=? AND m.active=1 AND c.active=1`).get(modelId) as Record<string, unknown> | undefined;
  if (!model) throw new ApiError(404, '사용 가능한 현장 자재 모델을 찾을 수 없습니다.', 'MODEL_NOT_FOUND');
  const quantity = asPositiveInteger(req.body?.quantity, '수정수량');
  const reason = asText(req.body?.reason, '수정사유', 1000);
  const oldSigned = Number(oldEntry.signed_quantity);
  const requestedState = String(req.body?.stockState || oldEntry.stock_state).toUpperCase();
  if (!['NORMAL', 'BAD'].includes(requestedState)) throw new ApiError(400, '재고상태가 올바르지 않습니다.', 'INVALID_STOCK_STATE');
  const direction = req.body?.direction == null ? Math.sign(oldSigned) : Number(req.body.direction);
  const replacementEntry = fieldEntryForEdit(type, quantity, requestedState, direction);
  const address = optionalText(req.body?.location ?? req.body?.address, 300) ?? String(original.location_text || '');
  const requestedRegionId = optionalText(req.body?.regionId, 100);
  const addressWasEdited = req.body?.location !== undefined || req.body?.address !== undefined;
  const regionId = user.role === 'team_leader'
    ? user.regionId
    : resolveFieldRegionId(address, requestedRegionId || (addressWasEdited ? null : originalRegionId));
  if (user.role === 'team_leader') {
    const resolved = resolveFieldRegionId(address, requestedRegionId);
    if (resolved && resolved !== user.regionId) throw new ApiError(403, '담당지역 밖의 주소로 수정할 수 없습니다.', 'REGION_SCOPE_FORBIDDEN');
  }
  if (type === 'FIELD_USE' && String(model.material_kind) === 'ACTIVE') {
    const photoCount = Number((db.prepare("SELECT COUNT(*) AS count FROM material_photo_assets WHERE transaction_id=? AND archive_status<>'DELETED' AND deleted_at IS NULL").get(String(original.id)) as { count: number }).count);
    if (photoCount !== 2) throw new ApiError(409, '능동자재 현장사용으로 변경하려면 전·후 사진이 필요합니다.', 'ACTIVE_PHOTOS_REQUIRED');
  }
  assertFieldReplacementStock(oldEntry, { modelId, state: replacementEntry.state, signed: replacementEntry.signed });
  const before = {
    transactionType: original.transaction_type, effectiveDate: original.effective_date,
    modelId: oldEntry.model_id, quantity: Math.abs(oldSigned), location: original.location_text,
    purpose: original.purpose, workDetails: original.work_details,
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    assertFieldReplacementStock(oldEntry, { modelId, state: replacementEntry.state, signed: replacementEntry.signed });
    db.prepare(`UPDATE inventory_transactions SET transaction_type=?,effective_date=?,region_id=?,company_name=?,location_text=?,purpose=?,work_details=?,reason=? WHERE id=?`)
      .run(type, effectiveDate, regionId,
        req.body?.companyName === undefined ? (original.company_name == null ? null : String(original.company_name)) : optionalText(req.body.companyName, 200),
        address,
        req.body?.purpose === undefined ? (original.purpose == null ? null : String(original.purpose)) : optionalText(req.body.purpose, 1000),
        req.body?.workDetails === undefined ? (original.work_details == null ? null : String(original.work_details)) : optionalText(req.body.workDetails, 3000),
        reason, String(original.id));
    db.prepare(`UPDATE field_material_entries SET model_id=?,stock_state=?,signed_quantity=?,unit_snapshot=?,model_name_snapshot=? WHERE id=?`)
      .run(modelId, replacementEntry.state, replacementEntry.signed, String(model.unit), String(model.model_name), String(oldEntry.id));
    insertAudit(String(original.id), user, 'INVENTORY_TRANSACTION_UPDATED', reason, {
      before,
      after: { transactionType: type, effectiveDate, modelId, quantity, location: address, purpose: req.body?.purpose ?? original.purpose, workDetails: req.body?.workDetails ?? original.work_details },
    }, null);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getTransaction(String(original.id));
};

export const updateFieldTransactionQuantity = (req: Request) => updateFieldTransaction(req);

export const deleteFieldTransaction = async (req: Request) => {
  const { user, original, entry } = fieldMutationTarget(req);
  const reason = asText(req.body?.reason, '삭제사유', 1000);
  assertOpenPeriod(String(original.effective_date));
  assertFieldReplacementStock(entry);
  await purgeMaterialTransactionPhotos(String(original.id), user.id, reason);
  db.exec('BEGIN IMMEDIATE');
  try {
    assertFieldReplacementStock(entry);
    db.prepare("UPDATE inventory_transactions SET status='REVERSED',reason=?,reversed_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(reason, String(original.id));
    insertAudit(String(original.id), user, 'INVENTORY_TRANSACTION_DELETED', reason, {
      transactionType: original.transaction_type,
      effectiveDate: original.effective_date,
      modelId: entry.model_id,
      quantity: Math.abs(Number(entry.signed_quantity)),
      location: original.location_text,
    }, null);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { id: String(original.id), deleted: true };
};

const activeCategoryNames = new Set(['ONU', '간선증폭기', '구내증폭기', '연장증폭기', '선로증폭기', '전원공급기_PS', '전원공급기_UPS']);
const officialSummaryModelNote = '공식 월간보고 요약시트 등록';
const officialDetailOnlyModelNote = '공식 월간보고 일괄등록';
const normalizedMaterialName = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
const indoorPassiveModels = new Set(['tv8-14', 'tv8-17', 'tv8-20', 'sv8']);
const canonicalImportedCategoryName = (categoryName: string, modelName: string) => {
  const categoryKey = String(categoryName).normalize('NFKC').replace(/[\s_()]/g, '').toLocaleLowerCase('ko-KR');
  const modelKey = normalizedMaterialName(modelName);
  if (['수동소자옥내용', '옥내용분배기', '옥내용8분기기'].includes(categoryKey) || indoorPassiveModels.has(modelKey)) return '수동소자(옥내용)';
  if (['수동소자류', '수동소자', '수동소자옥외용'].includes(categoryKey)) return '수동소자(옥외용)';
  if (categoryKey === '전원공급기ps') return '전원공급기_PS';
  if (categoryKey === '전원공급기ups') return '전원공급기_UPS';
  if (categoryKey === '공사성자재') return '공사성 자재';
  return categoryName;
};

const normalizedOfficialEffectiveDate = (sourceDate: string, sheetName: string, reportYear: number) => {
  const sourceYear = Number(sourceDate.slice(0, 4));
  const isMonthlyDetail = /^센터 자재 사용내역\(\d{2}월\)$/.test(sheetName);
  if (!isMonthlyDetail || sourceYear >= reportYear) return sourceDate;
  const sourceDay = Number(sourceDate.slice(8, 10));
  return `${reportYear}-01-${String(Math.min(sourceDay, 31)).padStart(2, '0')}`;
};

export const importOfficialFieldRows = (req: Request) => {
  const user = authUser(req);
  if (!elevatedRoles.has(user.role)) throw new ApiError(403, '공식 보고자료 일괄등록 권한이 없습니다.', 'FORBIDDEN');
  const sourceFile = asText(req.body?.sourceFile, '파일명', 300);
  const sourceHash = asText(req.body?.sourceHash, '파일 식별값', 100);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 10000) throw new ApiError(400, '등록자료는 1~10,000행이어야 합니다.', 'VALIDATION_ERROR');
  const requestedReportYear = Number(req.body?.reportYear);
  const inferredReportYear = Math.max(...rows.map((row) => Number(String(row?.effectiveDate || '').slice(0, 4))).filter(Number.isInteger));
  const reportYear = Number.isInteger(requestedReportYear) ? requestedReportYear : inferredReportYear;
  if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
    throw new ApiError(400, '공식 보고연도가 올바르지 않습니다.', 'VALIDATION_ERROR');
  }
  const sourceWorkbookBase64 = req.body?.sourceWorkbookBase64;
  let sourceWorkbook: Buffer | undefined;
  if (sourceWorkbookBase64 !== undefined) {
    if (typeof sourceWorkbookBase64 !== 'string' || sourceWorkbookBase64.length > 30 * 1024 * 1024) {
      throw new ApiError(400, '원본 엑셀 파일 데이터가 올바르지 않습니다.', 'VALIDATION_ERROR');
    }
    sourceWorkbook = Buffer.from(sourceWorkbookBase64, 'base64');
    if (sourceWorkbook.length < 4 || sourceWorkbook[0] !== 0x50 || sourceWorkbook[1] !== 0x4b) {
      throw new ApiError(400, '원본 엑셀 파일 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
    }
    if (createHash('sha256').update(sourceWorkbook).digest('hex') !== sourceHash.toLowerCase()) {
      throw new ApiError(400, '원본 엑셀 파일과 식별값이 일치하지 않습니다.', 'VALIDATION_ERROR');
    }
  }
  const officialSummaryModelKeys = new Set(rows
    .filter((row) => String(row?.sheetName || '') === '사급자재 사용내역')
    .map((row) => normalizedMaterialName(row?.modelName))
    .filter(Boolean));
  const hasAuthoritativeSummary = Boolean(sourceWorkbook && officialSummaryModelKeys.size);
  const order = (row: Record<string, unknown> | undefined) => row?.stocktakeTarget === true ? 4 : ({ OPENING: 0, RECEIPT: 1, RECOVERED_BAD: 2 }[String(row?.transactionType)] ?? 3);
  const sorted = [...rows].sort((a, b) => {
    const typeOrder = order(a) - order(b);
    if (order(a) === 0 || order(b) === 0 || order(a) === 4 || order(b) === 4) return typeOrder;
    const dateOrder = String(a?.effectiveDate).localeCompare(String(b?.effectiveDate));
    return dateOrder || typeOrder;
  });
  let inserted = 0;
  let skipped = 0;
  const issues: Array<{ rowNumber: number; message: string }> = [];
  const categories = db.prepare('SELECT id,category_name AS categoryName FROM field_material_categories WHERE active=1').all() as Array<{ id: string; categoryName: string }>;
  const categoryByName = new Map(categories.map((category) => [normalizedMaterialName(category.categoryName), category]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  type CachedModel = { id: string; categoryId: string; material_kind: string; notes: string };
  const modelCache = new Map<string, Map<string, CachedModel>>();
  const modelByName = new Map<string, CachedModel[]>();
  const cachedModels = db.prepare(`SELECT m.id,m.category_id AS categoryId,m.model_name AS modelName,m.material_kind,COALESCE(m.notes,'') AS notes
    FROM field_material_models m JOIN field_material_categories c ON c.id=m.category_id
    WHERE m.active=1 AND c.active=1`).all() as Array<CachedModel & { modelName: string }>;
  for (const model of cachedModels) {
    const key = normalizedMaterialName(model.modelName);
    const cached = { id: model.id, categoryId: model.categoryId, material_kind: model.material_kind, notes: model.notes };
    const categoryModels = modelCache.get(model.categoryId) || new Map<string, CachedModel>();
    categoryModels.set(key, cached);
    modelCache.set(model.categoryId, categoryModels);
    modelByName.set(key, [...(modelByName.get(key) || []), cached]);
  }
  const modelsForCategory = (categoryId: string) => {
    const cached = modelCache.get(categoryId) || new Map<string, CachedModel>();
    modelCache.set(categoryId, cached);
    return cached;
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (hasAuthoritativeSummary) {
      for (const model of cachedModels) {
        const key = normalizedMaterialName(model.modelName);
        if (model.notes !== officialDetailOnlyModelNote || officialSummaryModelKeys.has(key)) continue;
        db.prepare('UPDATE field_material_models SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(model.id);
        modelCache.get(model.categoryId)?.delete(key);
        const remaining = (modelByName.get(key) || []).filter((candidate) => candidate.id !== model.id);
        if (remaining.length) modelByName.set(key, remaining);
        else modelByName.delete(key);
      }
    }
    for (const raw of sorted) {
      try {
        const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const rowNumber = Number(row.rowNumber || 0);
        const sheetName = asText(row.sheetName, '시트명', 100);
        const transactionType = asText(row.transactionType, '거래유형', 50).toUpperCase();
        if (!['OPENING', 'RECEIPT', 'FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE', 'RECOVERED_BAD', 'ADJUSTMENT'].includes(transactionType)) throw new ApiError(400, '지원하지 않는 원천 거래유형입니다.', 'INVALID_TRANSACTION_TYPE');
        const sourceEffectiveDate = asDate(row.effectiveDate, '작업일자');
        const effectiveDate = normalizedOfficialEffectiveDate(sourceEffectiveDate, sheetName, reportYear);
        if (transactionType !== 'OPENING') assertOpenPeriod(effectiveDate);
        const sourceCategoryName = asText(row.categoryName, '품목', 100);
        const modelName = asText(row.modelName, '세부모델', 200);
        const categoryName = canonicalImportedCategoryName(sourceCategoryName, modelName);
        const unit = optionalText(row.unit, 20) || 'EA';
        const rawQuantity = Number(String(row.quantity ?? '').replaceAll(',',''));
        const stocktakeTarget = transactionType === 'ADJUSTMENT' && row.stocktakeTarget === true;
        const quantity = transactionType === 'OPENING' || stocktakeTarget
          ? (Number.isInteger(rawQuantity) && rawQuantity >= 0 ? rawQuantity : (()=>{throw new ApiError(400,'재고 수량은 0 이상의 정수여야 합니다.','VALIDATION_ERROR');})())
          : asPositiveInteger(row.quantity, '수량');
        const address = optionalText(row.address, 300) || '';
        const regionId = scopedFieldRegion(user, address, optionalText(row.regionId, 100));
        const idempotencyKey = `official:${sourceHash.slice(0,16)}:${sheetName.slice(-12)}:${rowNumber}:${transactionType}:${sourceEffectiveDate}:${String(row.stockState || '')}`.slice(0, 100);
        const existing = existingIdempotentTransaction(user.id, idempotencyKey);
        if (existing) {
          db.prepare(`
            UPDATE inventory_transactions
               SET effective_date=?,source_effective_date=?,source_report_year=?,source_sheet_name=?,source_row_number=?,
                   source_worker_name=COALESCE(?,source_worker_name),work_category=COALESCE(?,work_category),
                   company_name=COALESCE(?,company_name)
             WHERE id=?
          `).run(effectiveDate,sourceEffectiveDate,reportYear,sheetName,rowNumber,optionalText(row.workerName,100),optionalText(row.workCategory,50),optionalText(row.companyName,200),existing.id);
          db.prepare('UPDATE field_material_entries SET category_name_snapshot=? WHERE transaction_id=?')
            .run(sourceCategoryName,existing.id);
          if (sheetName === '사급자재 사용내역') {
            db.prepare(`
              UPDATE field_material_models
                 SET notes=?,updated_at=CURRENT_TIMESTAMP
               WHERE id=(SELECT model_id FROM field_material_entries WHERE transaction_id=? LIMIT 1)
                 AND notes=?
            `).run(officialSummaryModelNote,existing.id,officialDetailOnlyModelNote);
          }
          if (stocktakeTarget) {
            const existingEntry = db.prepare(`
              SELECT e.model_id AS modelId,e.stock_state AS stockState,e.signed_quantity AS signedQuantity,t.status
                FROM field_material_entries e
                JOIN inventory_transactions t ON t.id=e.transaction_id
               WHERE e.transaction_id=?
            `).get(existing.id) as { modelId: string; stockState: FieldStockState; signedQuantity: number; status: string } | undefined;
            if (existingEntry) {
              const postedContribution = existingEntry.status === 'POSTED' ? Number(existingEntry.signedQuantity) : 0;
              const balanceWithoutExisting = fieldBalance(existingEntry.modelId, existingEntry.stockState) - postedContribution;
              const adjustedDelta = quantity - balanceWithoutExisting;
              if (Math.abs(adjustedDelta) < 0.000001) {
                db.prepare("UPDATE inventory_transactions SET status='REVERSED',reversed_at=CURRENT_TIMESTAMP,reason='공식자료 현재고 일치' WHERE id=?").run(existing.id);
              } else {
                db.prepare('UPDATE field_material_entries SET signed_quantity=? WHERE transaction_id=?').run(adjustedDelta,existing.id);
                db.prepare("UPDATE inventory_transactions SET status='POSTED',reversed_at=NULL,reason=NULL WHERE id=?").run(existing.id);
              }
              insertAudit(existing.id, user, 'OFFICIAL_STOCKTAKE_REAPPLIED', `원본 ${sheetName} ${rowNumber}행`, {
                sourceFile, sourceHash, categoryName, modelName, quantity,
                stocktakeSourceColumn: optionalText(row.stocktakeSourceColumn, 2),
              }, idempotencyKey);
            }
          }
          skipped += 1;
          continue;
        }

        const normalizedModel = normalizedMaterialName(modelName);
        let category = categoryByName.get(normalizedMaterialName(categoryName));
        let model = category ? modelsForCategory(category.id).get(normalizedModel) : undefined;
        if (!model) {
          const matchingModels = modelByName.get(normalizedModel) || [];
          if (matchingModels.length === 1) {
            model = matchingModels[0];
            category = categoryById.get(model.categoryId);
          }
        }
        if (sheetName !== '사급자재 사용내역' && hasAuthoritativeSummary && !officialSummaryModelKeys.has(normalizedModel)) {
          if (!model || model.notes === officialDetailOnlyModelNote) {
            skipped += 1;
            continue;
          }
        }
        if (sheetName === '사급자재 사용내역' && model?.notes === officialDetailOnlyModelNote) {
          db.prepare('UPDATE field_material_models SET notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(officialSummaryModelNote,model.id);
          model.notes = officialSummaryModelNote;
        }
        if (!category) {
          category = { id: randomUUID(), categoryName };
          db.prepare('INSERT INTO field_material_categories (id,category_name,sort_order) VALUES (?,?,999)').run(category.id, categoryName);
          categoryByName.set(normalizedMaterialName(categoryName), category);
          categoryById.set(category.id, category);
        }
        const categoryModels = modelsForCategory(category.id);
        if (!model) {
          const modelNote = sheetName === '사급자재 사용내역' ? officialSummaryModelNote : officialDetailOnlyModelNote;
          model = { id: randomUUID(), categoryId: category.id, material_kind: activeCategoryNames.has(category.categoryName) ? 'ACTIVE' : 'PASSIVE', notes: modelNote };
          db.prepare('INSERT INTO field_material_models (id,category_id,model_name,unit,material_kind,notes) VALUES (?,?,?,?,?,?)')
            .run(model.id, category.id, modelName, unit, model.material_kind, modelNote);
          categoryModels.set(normalizedModel, model);
          modelByName.set(normalizedModel, [...(modelByName.get(normalizedModel) || []), model]);
        }
        const state = transactionType === 'RECOVERED_BAD' || String(row.stockState).toUpperCase() === 'BAD' ? 'BAD' : 'NORMAL';
        const previous = sheetName === '사급자재 사용내역'
          ? db.prepare(`
              SELECT t.id FROM inventory_transactions t
              JOIN field_material_entries e ON e.transaction_id=t.id
             WHERE t.domain='FIELD' AND t.status='POSTED' AND t.transaction_type=? AND t.effective_date=?
               AND e.model_id=? AND e.stock_state=? AND t.memo LIKE '원본:% / 사급자재 사용내역 %행'
             ORDER BY t.created_at DESC LIMIT 1
            `).get(transactionType,effectiveDate,model.id,state) as {id:string}|undefined
          : db.prepare(`
              SELECT t.id FROM inventory_transactions t
              JOIN field_material_entries e ON e.transaction_id=t.id
             WHERE t.domain='FIELD' AND t.status='POSTED' AND t.transaction_type=? AND t.effective_date=?
               AND e.model_id=? AND e.stock_state=? AND t.memo LIKE ?
             ORDER BY t.created_at DESC LIMIT 1
            `).get(transactionType,effectiveDate,model.id,state,`원본:% / ${sheetName} ${rowNumber}행`) as {id:string}|undefined;
        if (previous) db.prepare("UPDATE inventory_transactions SET status='REVERSED',reversed_at=CURRENT_TIMESTAMP,reason='공식자료 재업로드 대체' WHERE id=?").run(previous.id);
        const delta = transactionType === 'OPENING'
          ? quantity - fieldOpeningBalance(model.id,state as FieldStockState,effectiveDate)
          : stocktakeTarget ? quantity - fieldBalance(model.id, state as FieldStockState)
          : ['FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE'].includes(transactionType) ? -quantity : quantity;
        if ((transactionType === 'OPENING' || stocktakeTarget) && Math.abs(delta) < 0.000001) { skipped += 1; continue; }
        // 공식 월간보고는 과거 원장을 복원하는 자료이므로 중간 잔고가 음수여도
        // 이후 입고·현재고 보정 행까지 포함해 전체 보고서를 그대로 등록한다.
        const id = randomUUID();
        db.prepare(`
          INSERT INTO inventory_transactions (
            id,transaction_number,domain,transaction_type,effective_date,created_by,region_id,
            company_name,source_worker_name,work_category,source_report_year,source_sheet_name,source_row_number,source_effective_date,
            location_text,purpose,work_details,memo,idempotency_key
          ) VALUES (?,?,'FIELD',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(id, transactionNumber('FIELD'), transactionType, effectiveDate, user.id, regionId,
          optionalText(row.companyName, 200), optionalText(row.workerName, 100), optionalText(row.workCategory, 50),
          reportYear, sheetName, rowNumber, sourceEffectiveDate, address, optionalText(row.workDetails, 1000), optionalText(row.workDetails, 3000),
          `원본: ${sourceFile} / ${sheetName} ${rowNumber}행`, idempotencyKey);
        db.prepare(`INSERT INTO field_material_entries (id,transaction_id,model_id,stock_state,signed_quantity,unit_snapshot,model_name_snapshot,category_name_snapshot) VALUES (?,?,?,?,?,?,?,?)`)
          .run(randomUUID(), id, model.id, state, delta, unit, modelName, sourceCategoryName);
        insertAudit(id, user, 'OFFICIAL_FIELD_ROW_IMPORTED', `원본 ${sheetName} ${rowNumber}행`, {
          sourceFile, sourceHash, transactionType, categoryName, modelName, quantity, address,
          stocktakeSourceColumn: stocktakeTarget ? optionalText(row.stocktakeSourceColumn, 2) : undefined,
        }, idempotencyKey);
        inserted += 1;
      } catch (error) {
        if (error instanceof ApiError) issues.push({ rowNumber: Number(raw?.rowNumber || 0), message: error.message });
        else throw error;
      }
    }
    if (issues.length) throw new ApiError(409, `일괄등록 검증에 실패한 행이 ${issues.length}건 있습니다. 첫 오류: ${issues[0].rowNumber}행 ${issues[0].message}`, 'BULK_IMPORT_VALIDATION_FAILED');
    if (sourceWorkbook) {
      const fieldAuditRowId = Number((db.prepare(`
        SELECT COALESCE(MAX(a.rowid),0) AS rowId
          FROM inventory_audit_logs a
          JOIN inventory_transactions t ON t.id=a.transaction_id
         WHERE t.domain='FIELD'
      `).get() as { rowId: number }).rowId);
      db.prepare(`
        INSERT INTO inventory_official_workbooks
          (report_year,source_file,source_hash,workbook_blob,field_audit_rowid,imported_by)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(report_year) DO UPDATE SET
          source_file=excluded.source_file,source_hash=excluded.source_hash,
          workbook_blob=excluded.workbook_blob,field_audit_rowid=excluded.field_audit_rowid,
          imported_by=excluded.imported_by,imported_at=CURRENT_TIMESTAMP
      `).run(reportYear,sourceFile,sourceHash,sourceWorkbook,fieldAuditRowId,user.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { inserted, skipped };
};

const normalizedSpareValue = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .toLocaleLowerCase('ko-KR');

export const importStationInventoryRows = (req: Request) => {
  const user = authUser(req);
  if (!elevatedRoles.has(user.role)) throw new ApiError(403, '국사 예비품 일괄등록 권한이 없습니다.', 'FORBIDDEN');
  const sourceFile = asText(req.body?.sourceFile, '파일명', 300);
  const sourceHash = asText(req.body?.sourceHash, '파일 식별값', 100);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length || rows.length > 10000) throw new ApiError(400, '등록자료는 1~10,000행이어야 합니다.', 'VALIDATION_ERROR');

  type StationRecord = { id: string; stationName: string; normalizedKey: string };
  type ModelRecord = { id: string; manufacturer: string; itemType: string; modelName: string; unit: string };
  const stations = db.prepare('SELECT id,station_name AS stationName,normalized_key AS normalizedKey FROM spare_stations WHERE active=1').all() as StationRecord[];
  const stationByKey = new Map(stations.map((station) => [station.normalizedKey, station]));
  const models = db.prepare('SELECT id,manufacturer,item_type AS itemType,model_name AS modelName,unit FROM spare_models WHERE active=1').all() as ModelRecord[];
  const modelKey = (manufacturer: unknown, itemType: unknown, modelName: unknown) =>
    [manufacturer, itemType, modelName].map(normalizedSpareValue).join('\u0000');
  const modelByKey = new Map(models.map((model) => [modelKey(model.manufacturer, model.itemType, model.modelName), model]));
  const modelsByName = new Map<string, ModelRecord[]>();
  for (const model of models) {
    const key = normalizedSpareValue(model.modelName);
    modelsByName.set(key, [...(modelsByName.get(key) || []), model]);
  }
  const stateColumns: Array<[SpareStockState, string]> = [
    ['NEW', 'newQuantity'],
    ['SERVICEABLE', 'serviceableQuantity'],
    ['DEFECTIVE', 'defectiveQuantity'],
    ['IN_REPAIR', 'inRepairQuantity'],
  ];
  let inserted = 0;
  let skipped = 0;
  const issues: Array<{ rowNumber: number; message: string }> = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const raw of rows) {
      try {
        const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const rowNumber = Number(row.rowNumber || 0);
        const sheetName = asText(row.sheetName, '시트명', 100);
        const effectiveDate = asDate(row.effectiveDate, '기준일');
        const regionName = asText(row.regionName, '권역', 100);
        const stationName = asText(row.stationName, '국사', 100);
        const manufacturer = asText(row.manufacturer, '제조사', 100);
        const itemType = asText(row.itemType, '품목', 100);
        const modelName = asText(row.modelName, '모델명', 200);
        const unit = optionalText(row.unit, 20) || 'EA';
        const stationKey = normalizeStationName(stationName);
        let station = stationByKey.get(stationKey);
        if (!station) {
          station = { id: randomUUID(), stationName, normalizedKey: stationKey };
          db.prepare('INSERT INTO spare_stations (id,region_name,station_name,normalized_key,sort_order) VALUES (?,?,?,?,999)')
            .run(station.id, regionName, stationName, stationKey);
          stationByKey.set(stationKey, station);
        }
        const exactModelKey = modelKey(manufacturer, itemType, modelName);
        let model = modelByKey.get(exactModelKey);
        if (!model) {
          const sameName = modelsByName.get(normalizedSpareValue(modelName)) || [];
          if (sameName.length === 1) model = sameName[0];
        }
        if (!model) {
          model = { id: randomUUID(), manufacturer, itemType, modelName, unit };
          db.prepare("INSERT INTO spare_models (id,manufacturer,item_type,model_name,unit,notes) VALUES (?,?,?,?,?,'국사 예비품 현황 일괄등록')")
            .run(model.id, manufacturer, itemType, modelName, unit);
          modelByKey.set(exactModelKey, model);
          modelsByName.set(normalizedSpareValue(modelName), [...(modelsByName.get(normalizedSpareValue(modelName)) || []), model]);
        }
        for (const [state, column] of stateColumns) {
          const quantity = Number(String(row[column] ?? '').replaceAll(',', ''));
          if (!Number.isInteger(quantity) || quantity < 0) throw new ApiError(400, '재고 수량은 0 이상의 정수여야 합니다.', 'VALIDATION_ERROR');
          const idempotencyKey = `station-import:${sourceHash.slice(0, 16)}:${rowNumber}:${state}`.slice(0, 100);
          if (existingIdempotentTransaction(user.id, idempotencyKey)) { skipped += 1; continue; }
          const delta = quantity - spareBalance(station.id, model.id, state);
          if (Math.abs(delta) < 0.000001) { skipped += 1; continue; }
          const id = randomUUID();
          const reason = '국사 예비품 현황 일괄등록';
          db.prepare(`
            INSERT INTO inventory_transactions (
              id,transaction_number,domain,transaction_type,effective_date,created_by,
              source_station_id,purpose,memo,reason,idempotency_key
            ) VALUES (?,?,'STATION','ADJUSTMENT',?,?,?,?,?,?,?)
          `).run(id, transactionNumber('STATION'), effectiveDate, user.id, station.id, reason,
            `원본: ${sourceFile} / ${sheetName} ${rowNumber}행`, reason, idempotencyKey);
          db.prepare(`
            INSERT INTO spare_entries (
              id,transaction_id,station_id,model_id,stock_state,signed_quantity,unit_snapshot,model_name_snapshot
            ) VALUES (?,?,?,?,?,?,?,?)
          `).run(randomUUID(), id, station.id, model.id, state, delta, unit, modelName);
          insertAudit(id, user, 'STATION_INVENTORY_ROW_IMPORTED', reason, {
            sourceFile, sourceHash, sheetName, rowNumber, stationName, modelName, stockState: state, quantity, delta,
          }, idempotencyKey);
          inserted += 1;
        }
      } catch (error) {
        if (error instanceof ApiError) issues.push({ rowNumber: Number(raw?.rowNumber || 0), message: error.message });
        else throw error;
      }
    }
    if (issues.length) throw new ApiError(409, `일괄등록 검증에 실패한 행이 ${issues.length}건 있습니다. 첫 오류: ${issues[0].rowNumber}행 ${issues[0].message}`, 'BULK_IMPORT_VALIDATION_FAILED');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { inserted, skipped };
};

export const listFieldBalances = (asOf?: string) => db.prepare(`
  SELECT m.id AS modelId, m.model_name AS modelName, m.manufacturer, m.unit, m.material_kind AS materialKind,COALESCE(m.notes,'') AS notes,
         c.id AS categoryId, c.category_name AS categoryName,
         COALESCE(SUM(CASE WHEN e.stock_state='NORMAL' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS normalQuantity,
         COALESCE(SUM(CASE WHEN e.stock_state='BAD' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS badQuantity
    FROM field_material_models m
    JOIN field_material_categories c ON c.id=m.category_id
    LEFT JOIN field_material_entries e ON e.model_id=m.id
    LEFT JOIN inventory_transactions t ON t.id=e.transaction_id
   WHERE m.active=1 AND c.active=1
   GROUP BY m.id ORDER BY c.sort_order, c.category_name, m.model_name
`).all(...(asOf ? [asOf, asOf] : []));

export const listSpareBalances = (asOf?: string) => db.prepare(`
  SELECT s.id AS stationId, s.region_name AS regionName, s.station_name AS stationName,
         m.id AS modelId, m.manufacturer, m.item_type AS itemType, m.model_name AS modelName, m.unit,
         COALESCE(SUM(CASE WHEN e.stock_state='NEW' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS newQuantity,
         COALESCE(SUM(CASE WHEN e.stock_state='SERVICEABLE' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS serviceableQuantity,
         COALESCE(SUM(CASE WHEN e.stock_state='DEFECTIVE' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS defectiveQuantity,
         COALESCE(SUM(CASE WHEN e.stock_state='IN_REPAIR' AND t.status='POSTED' ${asOf ? 'AND t.effective_date <= ?' : ''} THEN e.signed_quantity ELSE 0 END),0) AS inRepairQuantity
    FROM spare_stations s CROSS JOIN spare_models m
    LEFT JOIN spare_entries e ON e.station_id=s.id AND e.model_id=m.id
    LEFT JOIN inventory_transactions t ON t.id=e.transaction_id
   WHERE s.active=1 AND m.active=1
   GROUP BY s.id,m.id
   ORDER BY s.sort_order,s.station_name,m.item_type,m.model_name
`).all(...(asOf ? [asOf, asOf, asOf, asOf] : []));

const fieldReadScope = (user: AuthUser) => {
  if (user.role === 'team_leader') {
    if (!user.regionId) return { sql: 'AND 1=0', params: [] as string[] };
    return {
      sql: `AND (t.region_id=? OR (t.region_id IS NULL AND EXISTS (
        SELECT 1 FROM users scoped_user
         WHERE scoped_user.region_id=? AND scoped_user.status='active' AND scoped_user.deleted_at IS NULL
           AND scoped_user.name=COALESCE(NULLIF(t.source_worker_name,''),u.name)
      )))`,
      params: [user.regionId, user.regionId],
    };
  }
  if (!['admin', 'public_official'].includes(user.role)) {
    return {
      sql: "AND (t.created_by=? OR COALESCE(NULLIF(t.source_worker_name,''),u.name)=?)",
      params: [user.id, user.name],
    };
  }
  return { sql: '', params: [] as string[] };
};

const stationReadScope = (user: AuthUser) => {
  if (user.role === 'team_leader') return user.regionId
    ? { sql: 'AND u.region_id=?', params: [user.regionId] }
    : { sql: 'AND 1=0', params: [] as string[] };
  if (!['admin', 'public_official'].includes(user.role)) {
    return { sql: 'AND t.created_by=?', params: [user.id] };
  }
  return { sql: '', params: [] as string[] };
};

export const listTransactions = (user: AuthUser, domain: InventoryDomain, limit = 300) => {
  const scope = domain === 'FIELD' ? fieldReadScope(user) : stationReadScope(user);
  return db.prepare(`
  SELECT t.id, t.transaction_number AS transactionNumber, t.domain, t.transaction_type AS transactionType,
         t.effective_date AS effectiveDate, t.status, t.purpose, t.work_details AS workDetails,
         t.memo, t.reason, t.company_name AS companyName, t.location_text AS location,
         t.region_id AS regionId, r.region_name AS regionName, t.created_at AS createdAt,
         u.name AS createdByName, COALESCE(NULLIF(t.source_worker_name,''),u.name) AS workerName,
         ss.station_name AS sourceStationName, ds.station_name AS destinationStationName,
         COALESCE((SELECT SUM(ABS(e.signed_quantity)) FROM field_material_entries e WHERE e.transaction_id=t.id),
                  (SELECT MAX(ABS(e.signed_quantity)) FROM spare_entries e WHERE e.transaction_id=t.id),0) AS quantity,
         COALESCE((SELECT MAX(e.model_name_snapshot) FROM field_material_entries e WHERE e.transaction_id=t.id),
                  (SELECT MAX(e.model_name_snapshot) FROM spare_entries e WHERE e.transaction_id=t.id),'') AS modelName
         ,COALESCE((SELECT MAX(COALESCE(NULLIF(e.category_name_snapshot,''),c.category_name)) FROM field_material_entries e
                     JOIN field_material_models m ON m.id=e.model_id
                    JOIN field_material_categories c ON c.id=m.category_id
                   WHERE e.transaction_id=t.id),'') AS categoryName
         ,(SELECT MAX(e.model_id) FROM field_material_entries e WHERE e.transaction_id=t.id) AS modelId
         ,(SELECT MAX(e.stock_state) FROM field_material_entries e WHERE e.transaction_id=t.id) AS stockState
    FROM inventory_transactions t JOIN users u ON u.id=t.created_by
    LEFT JOIN regions r ON r.id=t.region_id
    LEFT JOIN spare_stations ss ON ss.id=t.source_station_id
   LEFT JOIN spare_stations ds ON ds.id=t.destination_station_id
   WHERE t.domain=? AND t.status='POSTED' AND t.transaction_type<>'REVERSAL'
     ${scope.sql}
   ORDER BY t.effective_date DESC,t.created_at DESC LIMIT ?
  `).all(domain, ...scope.params, Math.min(Math.max(limit, 1), 1000));
};

export const getVisibleTransaction = (user: AuthUser, id: string) => {
  const transaction = db.prepare('SELECT domain FROM inventory_transactions WHERE id=?').get(id) as { domain: InventoryDomain } | undefined;
  if (!transaction) throw new ApiError(404, '거래를 찾을 수 없습니다.', 'TRANSACTION_NOT_FOUND');
  const scope = transaction.domain === 'FIELD' ? fieldReadScope(user) : stationReadScope(user);
  const visible = db.prepare(`
    SELECT t.id FROM inventory_transactions t
    JOIN users u ON u.id=t.created_by
    WHERE t.id=? ${scope.sql}
  `).get(id, ...scope.params);
  if (!visible) throw new ApiError(404, '거래를 찾을 수 없습니다.', 'TRANSACTION_NOT_FOUND');
  return getTransaction(id);
};

export type FieldUsageStatisticRow = { label: string; quantity: number; count: number };
export type FieldUsageItemStatisticRow = { categoryName: string; modelName: string; quantity: number; count: number };
export type FieldIssueDetailRow = { id: string; effectiveDate: string; releasePlace: string; issueType: string; categoryName: string; modelName: string; quantity: number };
export type FieldStatisticFilters = { regionName?: string; categoryName?: string; modelName?: string; workerName?: string; issueOnly?: boolean };

const fieldStatisticsSource = (user: AuthUser, start: string, end: string, group: 'ALL' | 'WORKER' | 'TEAM' = 'ALL', value = '', filters: FieldStatisticFilters = {}) => {
  const params: Array<string> = [start, end];
  const visibility = fieldReadScope(user);
  let scope = visibility.sql;
  params.push(...visibility.params);
  if (group === 'WORKER') {
    scope += " AND COALESCE(NULLIF(t.source_worker_name,''),u.name)=?";
    params.push(value);
  } else if (group === 'TEAM') {
    scope += " AND COALESCE(NULLIF(r.region_name,''),'미지정')=?";
    params.push(value);
  }
  if (filters.regionName) {
    scope += " AND COALESCE(NULLIF(r.region_name,''),'미지정')=?";
    params.push(filters.regionName);
  }
  if (filters.categoryName) {
    scope += ' AND c.category_name=?';
    params.push(filters.categoryName);
  }
  if (filters.modelName) {
    scope += ' AND e.model_name_snapshot=?';
    params.push(filters.modelName);
  }
  if (filters.workerName) {
    scope += " AND COALESCE(NULLIF(t.source_worker_name,''),u.name)=?";
    params.push(filters.workerName);
  }
  if (filters.issueOnly) scope += " AND t.transaction_type IN ('OTHER_COMPANY_ISSUE','HS_ISSUE')";
  const base = `
    FROM inventory_transactions t
    JOIN users u ON u.id=t.created_by
    JOIN field_material_entries e ON e.transaction_id=t.id
    JOIN field_material_models m ON m.id=e.model_id
    JOIN field_material_categories c ON c.id=m.category_id
    LEFT JOIN regions r ON r.id=t.region_id
   WHERE t.domain='FIELD' AND t.status='POSTED'
     AND t.transaction_type IN ('FIELD_USE','OTHER_COMPANY_ISSUE','HS_ISSUE')
     AND t.effective_date BETWEEN ? AND ? ${scope}`;
  return { base, params };
};

export const getFieldUsageStatistics = (user: AuthUser, start: string, end: string, filters: FieldStatisticFilters = {}) => {
  const { base, params } = fieldStatisticsSource(user, start, end, 'ALL', '', filters);
  const grouped = (expression: string) => db.prepare(`
    SELECT ${expression} AS label, SUM(ABS(e.signed_quantity)) AS quantity,
           COUNT(DISTINCT t.id) AS count
    ${base}
    GROUP BY label
    ORDER BY quantity DESC,label
  `).all(...params) as FieldUsageStatisticRow[];
  const totals = db.prepare(`
    SELECT COALESCE(SUM(ABS(e.signed_quantity)),0) AS totalQuantity,
           COALESCE(SUM(CASE WHEN t.transaction_type='FIELD_USE' THEN ABS(e.signed_quantity) ELSE 0 END),0) AS fieldUseQuantity,
           COALESCE(SUM(CASE WHEN t.transaction_type IN ('OTHER_COMPANY_ISSUE','HS_ISSUE') THEN ABS(e.signed_quantity) ELSE 0 END),0) AS issueQuantity,
           COUNT(DISTINCT t.id) AS transactionCount,
           COUNT(DISTINCT COALESCE(NULLIF(t.source_worker_name,''),u.name)) AS workerCount
    ${base}
  `).get(...params) as Record<string, number>;
  return {
    start,
    end,
    totals,
    byRegion: grouped("COALESCE(NULLIF(r.region_name,''),'미지정')"),
    byWorker: grouped("COALESCE(NULLIF(t.source_worker_name,''),u.name)"),
  };
};

export const getFieldUsageItemStatistics = (user: AuthUser, start: string, end: string, group: 'ALL' | 'WORKER' | 'TEAM', value: string, filters: FieldStatisticFilters = {}) => {
  const { base, params } = fieldStatisticsSource(user, start, end, group, value, filters);
  return db.prepare(`
    SELECT c.category_name AS categoryName, e.model_name_snapshot AS modelName,
           SUM(ABS(e.signed_quantity)) AS quantity, COUNT(DISTINCT t.id) AS count
    ${base}
    GROUP BY c.category_name,e.model_name_snapshot
    ORDER BY quantity DESC,c.category_name,e.model_name_snapshot
  `).all(...params) as FieldUsageItemStatisticRow[];
};

export const getFieldIssueDetails = (user: AuthUser, start: string, end: string, group: 'ALL' | 'WORKER' | 'TEAM', value: string, filters: FieldStatisticFilters = {}) => {
  const { base, params } = fieldStatisticsSource(user, start, end, group, value, filters);
  return db.prepare(`
    SELECT t.id, t.effective_date AS effectiveDate,
           COALESCE(NULLIF(t.location_text,''),NULLIF(t.company_name,''),NULLIF(r.region_name,''),'-') AS releasePlace,
           CASE t.transaction_type WHEN 'HS_ISSUE' THEN 'H&S 분출' ELSE '타사 분출' END AS issueType,
           c.category_name AS categoryName, e.model_name_snapshot AS modelName,
           ABS(e.signed_quantity) AS quantity
    ${base}
      AND t.transaction_type IN ('OTHER_COMPANY_ISSUE','HS_ISSUE')
    ORDER BY t.effective_date DESC,t.created_at DESC,c.category_name,e.model_name_snapshot
  `).all(...params) as FieldIssueDetailRow[];
};

export const getFieldStatisticMeta = (user: AuthUser) => {
  const allRegions = ['admin', 'public_official'].includes(user.role);
  const regions = db.prepare(`SELECT id,region_name AS name FROM regions WHERE active=1 ${allRegions ? "AND id IN (SELECT DISTINCT region_id FROM inventory_transactions WHERE domain='FIELD' AND status='POSTED' AND transaction_type IN ('FIELD_USE','OTHER_COMPANY_ISSUE','HS_ISSUE') AND region_id IS NOT NULL)" : 'AND id=?'} ORDER BY sort_order,region_name`)
    .all(...(allRegions ? [] : [user.regionId || ''])) as Array<{id:string;name:string}>;
  const visibility = fieldReadScope(user);
  const params = [...visibility.params];
  const scope = visibility.sql;
  const transactionWorkers = db.prepare(`
    SELECT COALESCE(NULLIF(t.source_worker_name,''),u.name) AS name,
           COALESCE(MAX(r.region_name),'') AS regionName
      FROM inventory_transactions t JOIN users u ON u.id=t.created_by
      LEFT JOIN regions r ON r.id=t.region_id
     WHERE t.domain='FIELD' AND t.status='POSTED' ${scope}
     GROUP BY name ORDER BY name
  `).all(...params) as Array<{name:string;regionName:string}>;
  const workerMap = new Map(transactionWorkers.map((worker)=>[worker.name,worker]));
  listAssignableFieldWorkers(user).forEach((worker)=>{
    const existing=workerMap.get(worker.name);
    if(!existing || (!existing.regionName && worker.regionName)) workerMap.set(worker.name,{name:worker.name,regionName:worker.regionName||''});
  });
  return { regions, workers: [...workerMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko')) };
};
