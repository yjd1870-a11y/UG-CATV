import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { normalizeStationName, textValue } from '../catv';
import { upsertCatvCellRecord } from '../catv-store';
import { removeFloorPlanObject, saveFloorPlanDataUrl } from '../floor-plan-storage';
import { ApiError, asText, asyncRoute, optionalText, success } from '../http';
import { hashPassword, isValidPassword, PASSWORD_POLICY_MESSAGE } from '../security/password';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { deleteAllStraightMaps, deleteStraightMapsForStation } from '../straight-map-pipeline';
import { buildB2CSearchValue } from '../b2c-search';
import { securityLog, writeAuditLog } from '../security/audit';
import { env } from '../env';
import {
  cancelStraightMapJob,
  completeStraightMapUpload,
  createStraightMapUpload,
  deleteStraightMapJob,
  listStraightMapJobs,
  retryStraightMapJob,
  rollbackStraightMapVersion,
  storeLocalStraightMapUpload,
} from '../straight-map-jobs';

const router = Router();
router.use(requireAuth, requireRoles('admin'));
router.use((req, _res, next) => {
  if (!env.isProduction || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = (req.get('origin') || '').replace(/\/$/, '');
  if (!origin || !env.adminMutationAllowedOrigins.has(origin)) {
    securityLog(req, { action: 'SECURITY_ADMIN_ORIGIN_BLOCKED', targetType: 'admin_route', targetId: req.path, metadata: { origin } });
    next(new ApiError(403, '이 배포 환경에서는 관리자 변경 작업을 수행할 수 없습니다.', 'ADMIN_ORIGIN_FORBIDDEN'));
    return;
  }
  next();
});
router.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  res.once('finish', () => {
    if (res.statusCode >= 400) return;
    let action = 'ADMIN_MUTATION';
    if (/\/users\/[^/]+\/role$/.test(req.path)) action = 'SECURITY_ROLE_CHANGED';
    else if (req.path.startsWith('/users')) action = req.method === 'DELETE' ? 'ACCOUNT_DELETED' : 'ACCOUNT_CHANGED';
    else if (/^\/db\/(upload|assets)/.test(req.path)) action = req.method === 'DELETE' ? 'DB_ASSET_DELETED' : 'SECURITY_DB_UPLOAD';
    else if (req.path === '/db/cells' && req.method === 'DELETE') action = 'DB_DATA_DELETED';
    const input = { action, targetType: 'admin_route', targetId: req.path, metadata: { method: req.method } };
    if (action.startsWith('SECURITY_')) securityLog(req, input);
    else writeAuditLog(req, input);
  });
  next();
});

type DbRole = 'manager' | 'guest' | 'public_official' | 'team_leader' | 'admin';
type CellUploadRecord = {
  keyNumber: string;
  cellName: string;
  stationName: string;
  stationAddress: string;
  otxNode: string;
  otxLineNumber: string;
  orxNode: string;
  orxLineNumber: string;
  spareNode: string;
  spareLineNumber: string;
  otxRack: string;
  otxShelf: string;
  otxPort: string;
  otxModel: string;
  orxRack: string;
  orxShelf: string;
  orxPort: string;
  orxModel: string;
  onuLocation: string;
  onuPhoto: string;
  onuPhotoList: string;
  onuManufacturer: string;
  onuModel: string;
  onuDivision: string;
  onuCellConfig: string;
  upsLocation: string;
  upsPhoto: string;
  upsPhotoList: string;
  upsManufacturer: string;
  upsModel: string;
  notes: string;
};

const catvCellFieldNames = [
  'keyNumber', 'cellName', 'stationName', 'stationAddress',
  'otxNode', 'otxLineNumber', 'orxNode', 'orxLineNumber', 'spareNode', 'spareLineNumber',
  'otxRack', 'otxShelf', 'otxPort', 'otxModel',
  'orxRack', 'orxShelf', 'orxPort', 'orxModel',
  'onuLocation', 'onuPhoto', 'onuPhotoList', 'onuManufacturer', 'onuModel', 'onuDivision', 'onuCellConfig',
  'upsLocation', 'upsPhoto', 'upsPhotoList', 'upsManufacturer', 'upsModel', 'notes',
] as const;

type PendingCellUpload = {
  userId: string;
  fileName: string;
  fileSize: number;
  records: CellUploadRecord[];
  currentCount: number;
  newCount: number;
  updatedCount: number;
  deletedCount: number;
  expiresAt: number;
};

const pendingCellUploads = new Map<string, PendingCellUpload>();
const allowedRoles = new Set<DbRole>(['manager', 'guest', 'public_official', 'team_leader', 'admin']);

const ensureRegion = (regionName: string) => {
  const existing = db.prepare('SELECT id FROM regions WHERE region_name = ? AND active = 1').get(regionName) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const nextOrder = Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM regions').get() as { value: number }).value);
  db.prepare('INSERT INTO regions (id, region_name, sort_order) VALUES (?, ?, ?)').run(id, regionName, nextOrder);
  return id;
};

const legacyRoleValue = (role: DbRole) => role === 'admin' ? 'admin' : role === 'team_leader' ? 'manager' : 'worker';
const allowedAssetTypes = new Set(['floor_plan', 'b2c']);

const rackCoordinatesOnly = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const coordinates: Record<string, Record<string, unknown>> = {};
  for (const [key, rawPoint] of Object.entries(input as Record<string, unknown>)) {
    if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) continue;
    const point = rawPoint as Record<string, unknown>;
    const kind = textValue(point.type || point.kind).toLowerCase();
    const explicitRackName = textValue(point.rackName);
    if (kind && kind !== 'rack' && !explicitRackName) continue;
    const rackName = explicitRackName || textValue(point.label) || textValue(key);
    if (!rackName) continue;
    let xRatio = Number(point.xRatio ?? point.x);
    let yRatio = Number(point.yRatio ?? point.y);
    if (xRatio > 1) xRatio /= 100;
    if (yRatio > 1) yRatio /= 100;
    if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) continue;
    coordinates[rackName] = {
      label: rackName,
      rackName,
      type: 'rack',
      equipmentType: textValue(point.equipmentType),
      xRatio,
      yRatio,
    };
  }
  return coordinates;
};

const rackCoordinatesJson = (input: unknown) => {
  try {
    return JSON.stringify(rackCoordinatesOnly(JSON.parse(String(input || '{}'))));
  } catch {
    return '{}';
  }
};

const passwordValue = (value: unknown) => {
  if (typeof value !== 'string' || !isValidPassword(value)) {
    throw new ApiError(400, PASSWORD_POLICY_MESSAGE, 'VALIDATION_ERROR');
  }
  return value;
};

const roleValue = (value: unknown): DbRole => {
  if (typeof value !== 'string' || !allowedRoles.has(value as DbRole)) {
    throw new ApiError(400, '허용되지 않은 권한입니다.', 'VALIDATION_ERROR');
  }
  return value as DbRole;
};

const usernameValue = (value: unknown) => {
  const username = asText(value, '아이디', 64);
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new ApiError(400, '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~64자여야 합니다.', 'VALIDATION_ERROR');
  }
  return username;
};

const publicUsers = (status?: string) => {
  const where = status ? 'AND status = ?' : '';
  return db.prepare(`
    SELECT u.id, u.username, u.zone, u.name, u.employee_number AS employeeNumber, u.department,
           phone, company,
           COALESCE(access_role, CASE role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) AS role,
           u.region_id AS regionId, r.region_name AS regionName,
           u.status, u.created_at AS createdAt, u.updated_at AS updatedAt,
           u.last_login_at AS lastLoginAt, u.password_updated_at AS passwordUpdatedAt,
           CASE WHEN length(password_hash) > 0 THEN 1 ELSE 0 END AS passwordConfigured
      FROM users u
      LEFT JOIN regions r ON r.id = u.region_id
     WHERE u.deleted_at IS NULL ${where}
     ORDER BY u.created_at DESC
  `).all(...(status ? [status] : []));
};

router.get('/users', (req, res) => {
  const requestedStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowed = ['pending', 'active', 'disabled'];
  if (requestedStatus && !allowed.includes(requestedStatus)) {
    throw new ApiError(400, '허용되지 않은 사용자 상태입니다.', 'VALIDATION_ERROR');
  }
  success(res, publicUsers(requestedStatus));
});

router.post('/users', asyncRoute(async (req, res) => {
  const username = usernameValue(req.body?.username);
  const zone = asText(req.body?.zone, '지역', 100);
  const name = asText(req.body?.name, '이름', 100);
  const role = roleValue(req.body?.role);
  const password = passwordValue(req.body?.password);
  const regionId = ensureRegion(zone);
  const existing = db.prepare('SELECT id, deleted_at AS deletedAt FROM users WHERE lower(username) = lower(?)').get(username) as { id: string; deletedAt: string | null } | undefined;
  if (existing && !existing.deletedAt) throw new ApiError(409, '이미 사용 중인 아이디입니다.', 'DUPLICATE_USERNAME');
  const employeeOwner = db.prepare('SELECT id, deleted_at AS deletedAt FROM users WHERE employee_number = ? AND id <> ?').get(username, existing?.id || '') as { id: string; deletedAt: string | null } | undefined;
  if (employeeOwner && !employeeOwner.deletedAt) throw new ApiError(409, '동일한 사번을 사용 중인 계정이 있습니다.', 'DUPLICATE_EMPLOYEE_NUMBER');
  if (employeeOwner?.deletedAt) db.prepare('UPDATE users SET employee_number = NULL WHERE id = ?').run(employeeOwner.id);

  const id = existing?.id || randomUUID();
  const passwordHash = await hashPassword(password);
  if (existing) {
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
    db.prepare(`
      UPDATE users SET
        username = ?, password_hash = ?, name = ?, zone = ?, employee_number = ?, department = ?,
        phone = NULL, company = '유지텔레컴', role = ?, access_role = ?, region_id = ?, status = 'active',
        last_login_at = NULL, password_updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(username, passwordHash, name, zone, username, zone, legacyRoleValue(role), role, regionId, id);
  } else {
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, name, zone, employee_number, department,
        company, role, access_role, region_id, status, password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '유지텔레컴', ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    `).run(id, username, passwordHash, name, zone, username, zone, legacyRoleValue(role), role, regionId);
  }
  success(res, { id, username, zone, name, role, status: 'active' }, 201);
}));

router.put('/users/:id/approve', asyncRoute(async (req, res) => {
  const pending = db.prepare('SELECT department FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as { department: string } | undefined;
  if (!pending) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  const regionId = ensureRegion(pending.department);
  const result = db.prepare(`
    UPDATE users SET status = 'active', region_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(regionId, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, { id: req.params.id, status: 'active' });
}));

router.put('/users/:id/disable', asyncRoute(async (req, res) => {
  if (authUser(req).id === req.params.id) throw new ApiError(400, '현재 로그인한 관리자 계정은 중지할 수 없습니다.', 'SELF_ACTION');
  const result = db.prepare(`
    UPDATE users SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, status: 'disabled' });
}));

router.put('/users/:id/enable', asyncRoute(async (req, res) => {
  const result = db.prepare(`
    UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, { id: req.params.id, status: 'active' });
}));

router.put('/users/:id/role', (req, res) => {
  const role = roleValue(req.body?.role);
  if (authUser(req).id === req.params.id && role !== 'admin') {
    throw new ApiError(400, '현재 로그인한 관리자 권한은 변경할 수 없습니다.', 'SELF_ACTION');
  }
  const result = db.prepare(`
    UPDATE users
       SET role = ?, access_role = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(legacyRoleValue(role), role, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND user_id <> ?').run(req.params.id, authUser(req).id);
  success(res, { id: req.params.id, role });
});

router.put('/users/:id/password', asyncRoute(async (req, res) => {
  const passwordHash = await hashPassword(passwordValue(req.body?.password));
  const result = db.prepare(`
    UPDATE users
       SET password_hash = ?, password_updated_at = CURRENT_TIMESTAMP,
           status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(passwordHash, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, passwordConfigured: true });
}));

router.delete('/users/:id', (req, res) => {
  if (authUser(req).id === req.params.id) throw new ApiError(400, '현재 로그인한 관리자 계정은 삭제할 수 없습니다.', 'SELF_ACTION');
  const result = db.prepare(`
    UPDATE users SET deleted_at = CURRENT_TIMESTAMP, status = 'disabled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, deleted: true });
});

const normalizeCellRecord = (value: unknown, index: number): CellUploadRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, String(index + 1) + '행 데이터 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
  }
  const source = value as Record<string, unknown>;
  const missingFields = catvCellFieldNames.filter((field) => !Object.prototype.hasOwnProperty.call(source, field));
  if (missingFields.length) {
    throw new ApiError(400, 'Excel 필수 열이 누락되었습니다: ' + missingFields.join(', '), 'MISSING_CELL_COLUMNS');
  }
  const text = (field: typeof catvCellFieldNames[number], maxLength = 500) =>
    (optionalText(source[field], maxLength) || '').replace(/_x000D_/gi, '').trim();
  const record = Object.fromEntries(catvCellFieldNames.map((field) => [field, text(field)])) as CellUploadRecord;
  record.keyNumber = asText(record.keyNumber, String(index + 1) + '행 키번호', 100);
  record.cellName = asText(record.cellName, String(index + 1) + '행 셀명', 100);
  record.stationName = asText(record.stationName, String(index + 1) + '행 국사명', 160);
  record.stationAddress = asText(record.stationAddress, String(index + 1) + '행 국사주소', 500);
  return record;
};

const cellRegion = (record: CellUploadRecord) => {
  const prefix = record.stationName.split('_')[0]?.trim();
  return prefix || record.stationName.replace(/국사$/, '').trim() || '미지정';
};

const cellDetails = (record: CellUploadRecord) => ({
  ...record,
  stationInfo: record.stationName,
  opticalNode: record.otxNode,
  lineCode: record.otxLineNumber,
  address: record.onuLocation || record.stationAddress,
  region: cellRegion(record),
  status: '정상',
  responsibleTeam: cellRegion(record),
  remarks: record.notes,
  trunkAmpCount: 0,
  extenderCount: 0,
  tapCount: 0,
  subscriberCount: 0,
  stationDetails: {
    descriptionCode: record.keyNumber,
    stationName: record.stationName,
    stationAddress: record.stationAddress,
    lineInfoList: [
      { item: 'OTX', node: record.otxNode, lineNo: record.otxLineNumber },
      { item: 'ORX', node: record.orxNode, lineNo: record.orxLineNumber },
      { item: '예비', node: record.spareNode, lineNo: record.spareLineNumber },
    ],
    transceiverList: [
      { item: 'OTX', rack: record.otxRack, shelf: record.otxShelf, port: record.otxPort, model: record.otxModel },
      { item: 'ORX', rack: record.orxRack, shelf: record.orxShelf, port: record.orxPort, model: record.orxModel },
    ],
  },
  hfcDetails: {
    onu: {
      location: record.onuLocation,
      manufacturer: record.onuManufacturer,
      modelName: record.onuModel,
      divisionType: record.onuDivision,
      cellConfig: record.onuCellConfig,
    },
    ups: {
      location: record.upsLocation,
      manufacturer: record.upsManufacturer,
      modelName: record.upsModel,
    },
  },
  diagramData: {
    opticalRxLevel: '-', rfOutLevel: '-', returnLevel: '-', freqBand: '-',
    tbaList: [], tapList: [],
  },
  floorPlanData: {
    rackNumber: record.otxRack,
    odfPosition: record.otxShelf + ' / ' + record.otxPort,
    transmitter: record.otxModel,
    edfa: '-',
    cmtsPort: '-',
    notes: record.notes,
  },
});

const persistedCell = (record: CellUploadRecord) => ({
  cellName: record.cellName,
  cellCode: record.keyNumber,
  nodeName: record.otxNode || '미지정',
  lineCode: record.otxLineNumber || record.keyNumber,
  address: record.onuLocation || record.stationAddress,
  region: cellRegion(record),
  status: '정상',
  memo: record.notes,
  responsibleTeam: cellRegion(record),
  detailsJson: JSON.stringify(cellDetails(record)),
});

const uploadDiff = (records: CellUploadRecord[]) => {
  const current = db.prepare(`
    SELECT cell_code AS cellCode, cell_name AS cellName, node_name AS nodeName,
           line_code AS lineCode, address, region, status, memo,
           responsible_team AS responsibleTeam, details_json AS detailsJson
      FROM cells WHERE deleted_at IS NULL
  `).all() as Array<Record<string, unknown>>;
  const currentByCode = new Map(current.map((row) => [String(row.cellCode).toLowerCase(), row]));
  let newCount = 0;
  let updatedCount = 0;
  for (const record of records) {
    const existing = currentByCode.get(record.keyNumber.toLowerCase());
    if (!existing) {
      newCount += 1;
      continue;
    }
    const next = persistedCell(record);
    let existingDetails: Record<string, unknown> = {};
    try {
      existingDetails = JSON.parse(String(existing.detailsJson || '{}')) as Record<string, unknown>;
    } catch {
      existingDetails = {};
    }
    const detailChanged = catvCellFieldNames.some((field) => String(existingDetails[field] ?? '') !== record[field]);
    const coreChanged = String(existing.cellName) !== next.cellName
      || String(existing.nodeName) !== next.nodeName
      || String(existing.lineCode || '') !== next.lineCode
      || String(existing.address) !== next.address
      || String(existing.region) !== next.region
      || String(existing.status) !== next.status
      || String(existing.memo || '') !== next.memo
      || String(existing.responsibleTeam || '') !== next.responsibleTeam;
    if (detailChanged || coreChanged) updatedCount += 1;
  }
  return { currentCount: current.length, newCount, updatedCount, deletedCount: 0 };
};
router.get('/audit-logs', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const action = typeof req.query.action === 'string' ? req.query.action.trim().slice(0, 100) : '';
  const where = action ? 'WHERE action = ?' : '';
  const params = action ? [action] : [];
  const rows = db.prepare(`
    SELECT id, user_id AS userId, role, action, target_type AS targetType,
           target_id AS targetId, ip_address AS ipAddress, user_agent AS userAgent,
           created_at AS createdAt, metadata
      FROM audit_logs ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit) as Array<Record<string, unknown>>;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...params) as { count: number }).count);
  success(res, {
    items: rows.map((row) => {
      try { return { ...row, metadata: JSON.parse(String(row.metadata || '{}')) }; }
      catch { return { ...row, metadata: {} }; }
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/db/status', (_req, res) => {
  const counts = {
    accounts: Number((db.prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL').get() as { count: number }).count),
    cells: Number((db.prepare('SELECT COUNT(*) AS count FROM catv_cells').get() as { count: number }).count),
    floorPlans: Number((db.prepare('SELECT COUNT(*) AS count FROM catv_floor_plans').get() as { count: number }).count),
    b2c: Number((db.prepare('SELECT COUNT(*) AS count FROM catv_b2c_lines').get() as { count: number }).count),
  };
  success(res, { storage: 'sqlite', counts });
});
router.get('/db/cells', (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = query
    ? " AND (cell_name LIKE ? ESCAPE '\\' OR cell_code LIKE ? ESCAPE '\\' OR node_name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR details_json LIKE ? ESCAPE '\\')"
    : '';  const params = query ? [pattern, pattern, pattern, pattern, pattern] : [];
  const rows = db.prepare(`
    SELECT id, cell_name, cell_code, node_name, line_code, address, region,
           status, memo, responsible_team, details_json, updated_at
      FROM cells WHERE deleted_at IS NULL ${where}
     ORDER BY CASE WHEN cell_code GLOB '[0-9]*' THEN CAST(cell_code AS INTEGER) END, cell_name
     LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<Record<string, unknown>>;
  const total = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM cells WHERE deleted_at IS NULL ${where}`
  ).get(...params) as { count: number }).count);

  const items = rows.map((row) => {
    let saved: Record<string, unknown> = {};
    try {
      saved = JSON.parse(String(row.details_json || '{}')) as Record<string, unknown>;
    } catch {
      saved = {};
    }
    const record = Object.fromEntries(catvCellFieldNames.map((field) => [field, String(saved[field] ?? '')])) as CellUploadRecord;
    record.keyNumber ||= String(row.cell_code || '');
    record.cellName ||= String(row.cell_name || '');
    record.stationName ||= String(saved.stationInfo || '');
    record.stationAddress ||= String(saved.stationDetails && typeof saved.stationDetails === 'object'
      ? (saved.stationDetails as Record<string, unknown>).stationAddress || ''
      : '');
    record.otxNode ||= String(row.node_name || '');
    record.otxLineNumber ||= String(row.line_code || '');
    record.onuLocation ||= String(row.address || '');
    record.notes ||= String(row.memo || '');
    return {
      id: String(row.id),
      ...record,
      status: String(row.status || '정상'),
      updatedAt: String(row.updated_at || ''),
    };
  });

  success(res, {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.post('/db/validate', (req, res) => {
  const fileName = asText(req.body?.fileName, '파일명', 255);
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new ApiError(400, 'XLSX, XLS, CSV 파일만 등록할 수 있습니다.', 'INVALID_FILE');
  const mimeType = asText(req.body?.mimeType, '파일 MIME 형식', 120).toLowerCase();
  const allowedMimeTypes = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
  ]);
  if (!allowedMimeTypes.has(mimeType)) throw new ApiError(400, 'Excel/CSV MIME 형식이 올바르지 않습니다.', 'INVALID_FILE_TYPE');
  const fileSize = Number(req.body?.fileSize || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024) {
    throw new ApiError(400, '파일은 최대 20MB까지 등록할 수 있습니다.', 'INVALID_FILE_SIZE');
  }
  if (!Array.isArray(req.body?.records) || req.body.records.length === 0 || req.body.records.length > 50_000) {
    throw new ApiError(400, 'CELL 데이터는 1~50,000행이어야 합니다.', 'VALIDATION_ERROR');
  }
  const records = req.body.records.map(normalizeCellRecord);
  const keys = new Set<string>();
  for (const record of records) {
    const key = record.keyNumber.toLowerCase();
    if (keys.has(key)) throw new ApiError(400, `중복 CELL 코드가 있습니다: ${record.keyNumber}`, 'DUPLICATE_CELL');
    keys.add(key);
  }
  const validationId = randomUUID();
  const diff = uploadDiff(records);
  const now = Date.now();
  for (const [id, pending] of pendingCellUploads) if (pending.expiresAt <= now) pendingCellUploads.delete(id);
  while (pendingCellUploads.size >= 10) pendingCellUploads.delete(pendingCellUploads.keys().next().value as string);
  pendingCellUploads.set(validationId, {
    userId: authUser(req).id,
    fileName,
    fileSize,
    records,
    ...diff,
    expiresAt: now + 15 * 60 * 1000,
  });
  success(res, { valid: true, validationId, recordCount: records.length, ...diff });
});

router.post('/db/upload', (req, res) => {
  const validationId = asText(req.body?.validationId, '검증 ID', 100);
  const pending = pendingCellUploads.get(validationId);
  if (!pending || pending.expiresAt <= Date.now()) throw new ApiError(400, '검증이 만료되었습니다. 파일을 다시 선택해주세요.', 'VALIDATION_EXPIRED');
  if (pending.userId !== authUser(req).id) throw new ApiError(403, '다른 관리자에게 발급된 검증입니다.', 'FORBIDDEN');
  const diff = uploadDiff(pending.records);
  const existingRows = db.prepare('SELECT id, lower(cell_code) AS code FROM cells').all() as Array<{ id: string; code: string }>;
  const existingByCode = new Map(existingRows.map((row) => [row.code, row.id]));

  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare(`
      UPDATE cells SET cell_name = ?, node_name = ?, line_code = ?, address = ?, region = ?,
        status = ?, memo = ?, responsible_team = ?, details_json = ?, deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    const insert = db.prepare(`
      INSERT INTO cells (
        id, cell_name, cell_code, node_name, line_code, address, region,
        status, memo, responsible_team, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const record of pending.records) {
      const id = existingByCode.get(record.keyNumber.toLowerCase()) || randomUUID();
      const next = persistedCell(record);
      if (existingByCode.has(record.keyNumber.toLowerCase())) {
        update.run(
          next.cellName, next.nodeName, next.lineCode, next.address, next.region,
          next.status, next.memo, next.responsibleTeam, next.detailsJson, id
        );
      } else {
        insert.run(
          id, next.cellName, next.cellCode, next.nodeName, next.lineCode,
          next.address, next.region, next.status, next.memo, next.responsibleTeam, next.detailsJson
        );
      }
      upsertCatvCellRecord(record, id);
    }
    const historyId = randomUUID();
    db.prepare(`
      INSERT INTO db_upload_history (
        id, db_type, file_name, file_size, record_count, new_count,
        updated_count, deleted_count, uploaded_by, status
      ) VALUES (?, 'cell', ?, ?, ?, ?, ?, ?, ?, 'success')
    `).run(historyId, pending.fileName, pending.fileSize, pending.records.length, diff.newCount, diff.updatedCount, diff.deletedCount, authUser(req).id);
    db.exec('COMMIT');
    pendingCellUploads.delete(validationId);
    const history = db.prepare(`
      SELECT h.*, u.username AS uploadedBy FROM db_upload_history h
      JOIN users u ON u.id = h.uploaded_by WHERE h.id = ?
    `).get(historyId);
    success(res, { uploaded: true, history });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

router.get('/db/history', (_req, res) => {
  const rows = db.prepare(`
    SELECT h.id, h.db_type AS dbType, h.file_name AS fileName, h.file_size AS fileSize,
           h.record_count AS recordCount, h.new_count AS newCount, h.updated_count AS updatedCount,
           h.deleted_count AS deletedCount, u.username AS uploadedBy,
           h.uploaded_at AS uploadedAt, h.status, h.message
      FROM db_upload_history h JOIN users u ON u.id = h.uploaded_by
     ORDER BY h.uploaded_at DESC LIMIT 10
  `).all();
  success(res, rows);
});

router.delete('/db/cells', (req, res) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      UPDATE cells SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE deleted_at IS NULL
    `).run();
    db.prepare('DELETE FROM catv_cells').run();
    db.prepare(`
      INSERT INTO db_upload_history (
        id, db_type, file_name, record_count, deleted_count, uploaded_by, status, message
      ) VALUES (?, 'cell', '관리자 전체 삭제', 0, ?, ?, 'success', '관리자 화면에서 CELL DB 전체 삭제')
    `).run(randomUUID(), result.changes, authUser(req).id);
    db.exec('COMMIT');
    success(res, { deletedCount: result.changes });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

router.get('/db/assets', (req, res) => {
  const dbType = typeof req.query.type === 'string' ? req.query.type : '';
  if (!allowedAssetTypes.has(dbType)) throw new ApiError(400, 'DB 자산 종류를 확인해주세요.', 'VALIDATION_ERROR');
  if (dbType === 'floor_plan') {
    const rows = db.prepare(`
      SELECT a.id, a.db_type AS dbType, a.station_name AS stationName, a.file_name AS fileName,
             a.mime_type AS mimeType, a.file_size AS fileSize, a.record_count AS recordCount,
             a.coordinates_json AS coordinatesJson, u.username AS uploadedBy,
             a.uploaded_at AS uploadedAt, a.updated_at AS updatedAt,
             p.id AS floorPlanId, p.plan_order AS planOrder
        FROM admin_db_assets a
        JOIN users u ON u.id = a.uploaded_by
        JOIN catv_floor_plans p ON p.id = a.floor_plan_id
       WHERE a.db_type = 'floor_plan' AND a.deleted_at IS NULL
       ORDER BY p.station_name, p.plan_order
    `).all() as Array<Record<string, unknown>>;
    success(res, rows.map((row) => ({
      ...row,
      displayName: `도면 ${Number(row.planOrder)}`,
      coordinatesJson: rackCoordinatesJson(row.coordinatesJson),
      imageUrl: `/api/floor-plans/${encodeURIComponent(String(row.floorPlanId))}/image`,
    })));
    return;
  }
  const rows = db.prepare(`
    SELECT a.id, a.db_type AS dbType, a.station_name AS stationName, a.file_name AS fileName,
           a.mime_type AS mimeType, a.file_size AS fileSize, a.record_count AS recordCount,
           a.coordinates_json AS coordinatesJson, u.username AS uploadedBy,
           a.uploaded_at AS uploadedAt, a.updated_at AS updatedAt
      FROM admin_db_assets a JOIN users u ON u.id = a.uploaded_by
     WHERE a.db_type = ? AND a.deleted_at IS NULL ORDER BY a.uploaded_at DESC
  `).all(dbType) as Array<Record<string, unknown>>;
  success(res, rows);
});

router.post('/db/assets', asyncRoute(async (req, res) => {
  const dbType = asText(req.body?.dbType, 'DB 종류', 30);
  if (!allowedAssetTypes.has(dbType)) throw new ApiError(400, 'DB 자산 종류를 확인해주세요.', 'VALIDATION_ERROR');
  const stationName = asText(req.body?.stationName, '국사명', 100);
  const fileName = asText(req.body?.fileName, '파일명', 255);
  const fileSize = Number(req.body?.fileSize || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024) throw new ApiError(400, '파일 크기를 확인해주세요.', 'INVALID_FILE_SIZE');
  const allowed = dbType === 'floor_plan' ? /\.(png|jpe?g|webp)$/i : /\.(xlsx|xls|csv)$/i;
  if (!allowed.test(fileName)) throw new ApiError(400, '지원하지 않는 파일 형식입니다.', 'INVALID_FILE');
  const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 50_000) : [];
  const coordinates = dbType === 'floor_plan' ? rackCoordinatesOnly(req.body?.coordinates) : {};
  const id = randomUUID();
  let savedFloorPlanObject: string | null = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (dbType === 'floor_plan' && /\.(png|jpe?g|webp)$/i.test(fileName)) {
      const imageDataUrl = textValue((records[0] as Record<string, unknown> | undefined)?.imageDataUrl);
      if (!imageDataUrl) throw new ApiError(400, '평면도 이미지 데이터가 없습니다.', 'INVALID_FILE');
      const stationKey = normalizeStationName(stationName);
      const usedOrders = new Set(
        (db.prepare('SELECT plan_order FROM catv_floor_plans WHERE station_key = ?').all(stationKey) as Array<{ plan_order: number }>)
          .map((entry) => Number(entry.plan_order))
      );
      const planOrder = [1, 2, 3].find((candidate) => !usedOrders.has(candidate));
      if (!planOrder) throw new ApiError(409, '한 국사에는 평면도를 최대 3장까지 등록할 수 있습니다.', 'FLOOR_PLAN_LIMIT_EXCEEDED');
      const stored = await saveFloorPlanDataUrl(id, imageDataUrl);
      savedFloorPlanObject = stored.objectKey;
      db.prepare(`
        INSERT INTO catv_floor_plans (id, station_name, station_key, plan_order, file_name, object_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, stationName, stationKey, planOrder, fileName, stored.objectKey);
      const insertCoordinate = db.prepare(`
        INSERT INTO catv_floor_plan_coordinates (
          id, floor_plan_id, label, node_name, rack_name, equipment_type, x_ratio, y_ratio
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [label, rawPoint] of Object.entries(coordinates as Record<string, unknown>)) {
        if (!rawPoint || typeof rawPoint !== 'object') continue;
        const point = rawPoint as Record<string, unknown>;
        let xRatio = Number(point.xRatio ?? point.x);
        let yRatio = Number(point.yRatio ?? point.y);
        if (xRatio > 1) xRatio /= 100;
        if (yRatio > 1) yRatio /= 100;
        if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) continue;
        const rackName = textValue(point.rackName) || textValue(point.label) || label;
        insertCoordinate.run(randomUUID(), id, rackName, '', rackName, textValue(point.equipmentType), xRatio, yRatio);
      }
    }

    if (dbType === 'b2c') {
      const stationKey = normalizeStationName(stationName);
      db.prepare('DELETE FROM catv_b2c_lines WHERE station_key = ?').run(stationKey);
      const priorAssets = db.prepare("SELECT id, station_name FROM admin_db_assets WHERE db_type = 'b2c' AND deleted_at IS NULL").all() as Array<{ id: string; station_name: string }>;
      const archiveAsset = db.prepare('UPDATE admin_db_assets SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const asset of priorAssets) if (normalizeStationName(asset.station_name) === stationKey) archiveAsset.run(asset.id);
      const insertLine = db.prepare(`
        INSERT INTO catv_b2c_lines (
          id, station_name, station_key, service_name, b2c_name, node, line, core,
          service_line_number, service_category, service_type, memo, search_values,
          normalized_search, sheet_name, row_number, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const source of records) {
        const row = source as Record<string, unknown>;
        const value = (...keys: string[]) => {
          const key = keys.find((candidate) => row[candidate] !== undefined);
          return key ? textValue(row[key]) : '';
        };
        const serviceName = value('serviceName', '서비스회선명', '서비스 회선명');
        const b2cName = value('b2cName', 'B2C명', '셀명') || serviceName;
        const node = value('node', '노드', '노드명');
        const core = value('core', '코어', 'line', '선번');
        const serviceLineNumber = value('serviceLineNumber', '서비스회선번호', '서비스 회선번호');
        const serviceCategory = value('serviceCategory', '서비스구분', '서비스 구분');
        const serviceType = value('serviceType', '서비스타입', '서비스 타입');
        const memo = value('memo', '비고');
        const supplied = Array.isArray(row.searchValues) ? row.searchValues.map(textValue).filter(Boolean) : [];
        const searchValues = supplied.length ? supplied : [serviceLineNumber, serviceName, serviceCategory, serviceType, memo].filter(Boolean);
        if (!searchValues.length || (!node && !core)) continue;
        insertLine.run(
          randomUUID(), stationName, stationKey, serviceName, b2cName, node, core, core,
          serviceLineNumber, serviceCategory, serviceType, memo, JSON.stringify(searchValues),
          buildB2CSearchValue(searchValues), value('sheetName'), Number(value('rowNumber')) || null, fileName
        );
      }
    }

    db.prepare(`
      INSERT INTO admin_db_assets (
        id, db_type, floor_plan_id, station_name, file_name, mime_type, file_size,
        record_count, coordinates_json, data_json, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
    `).run(id, dbType, dbType === 'floor_plan' ? id : null, stationName, fileName, optionalText(req.body?.mimeType, 100), fileSize, records.length, JSON.stringify(coordinates), authUser(req).id);
    db.prepare(`
      INSERT INTO db_upload_history (id, db_type, file_name, file_size, record_count, uploaded_by, status)
      VALUES (?, ?, ?, ?, ?, ?, 'success')
    `).run(randomUUID(), dbType, fileName, fileSize, records.length, authUser(req).id);
    db.exec('COMMIT');
    success(res, { id, dbType, stationName, fileName, recordCount: records.length }, 201);
  } catch (error) {
    db.exec('ROLLBACK');
    if (savedFloorPlanObject) {
      await removeFloorPlanObject(savedFloorPlanObject).catch(() => undefined);
    }
    throw error;
  }
}));

router.put('/db/assets/:id', asyncRoute(async (req, res) => {
  const asset = db.prepare(`
    SELECT * FROM admin_db_assets WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id) as Record<string, unknown> | undefined;
  if (!asset) throw new ApiError(404, '등록된 DB 파일을 찾을 수 없습니다.', 'NOT_FOUND');
  if (asset.db_type !== 'floor_plan') throw new ApiError(400, '국사 평면도만 이 화면에서 수정할 수 있습니다.', 'INVALID_ASSET_TYPE');

  const stationName = optionalText(req.body?.stationName, 100) || String(asset.station_name);
  const stationKey = normalizeStationName(stationName);
  const planId = String(asset.floor_plan_id || asset.id);
  const plan = db.prepare('SELECT * FROM catv_floor_plans WHERE id = ?').get(planId) as Record<string, unknown> | undefined;
  if (!plan) throw new ApiError(404, '수정할 국사 평면도를 찾을 수 없습니다.', 'FLOOR_PLAN_NOT_FOUND');
  let planOrder = Number(plan.plan_order);
  if (stationKey !== String(plan.station_key)) {
    const usedOrders = new Set(
      (db.prepare('SELECT plan_order FROM catv_floor_plans WHERE station_key = ? AND id <> ?').all(stationKey, planId) as Array<{ plan_order: number }>)
        .map((entry) => Number(entry.plan_order))
    );
    planOrder = [planOrder, 1, 2, 3].find((candidate) => candidate >= 1 && candidate <= 3 && !usedOrders.has(candidate)) || 0;
    if (!planOrder) throw new ApiError(409, '한 국사에는 평면도를 최대 3장까지 등록할 수 있습니다.', 'FLOOR_PLAN_LIMIT_EXCEEDED');
  }

  const coordinates = rackCoordinatesOnly(req.body?.coordinates);
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  const imageDataUrl = textValue((records[0] as Record<string, unknown> | undefined)?.imageDataUrl);
  const requestedFileName = optionalText(req.body?.fileName, 255);
  const fileName = requestedFileName || String(asset.file_name);
  const fileSize = imageDataUrl ? Number(req.body?.fileSize || 0) : Number(asset.file_size || 0);
  if (imageDataUrl && (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024)) {
    throw new ApiError(400, '파일 크기를 확인해주세요.', 'INVALID_FILE_SIZE');
  }
  if (imageDataUrl && !/\.(png|jpe?g|webp)$/i.test(fileName)) throw new ApiError(400, '지원하지 않는 평면도 파일 형식입니다.', 'INVALID_FILE');

  db.exec('BEGIN IMMEDIATE');
  try {
    const previousObjectKey = String(plan.object_key || '');
    let objectKey = previousObjectKey;
    if (imageDataUrl) {
      objectKey = (await saveFloorPlanDataUrl(planId, imageDataUrl)).objectKey;
    }
    db.prepare(`
      UPDATE catv_floor_plans
         SET station_name = ?, station_key = ?, plan_order = ?, file_name = ?, object_key = ?, image_url = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(stationName, stationKey, planOrder, fileName, objectKey || null, planId);

    db.prepare('DELETE FROM catv_floor_plan_coordinates WHERE floor_plan_id = ?').run(planId);
    const insertCoordinate = db.prepare(`
      INSERT INTO catv_floor_plan_coordinates (
        id, floor_plan_id, label, node_name, rack_name, equipment_type, x_ratio, y_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [label, rawPoint] of Object.entries(coordinates as Record<string, unknown>)) {
      if (!rawPoint || typeof rawPoint !== 'object') continue;
      const point = rawPoint as Record<string, unknown>;
      let xRatio = Number(point.xRatio ?? point.x);
      let yRatio = Number(point.yRatio ?? point.y);
      if (xRatio > 1) xRatio /= 100;
      if (yRatio > 1) yRatio /= 100;
      if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) continue;
      const rackName = textValue(point.rackName) || textValue(point.label) || label;
      insertCoordinate.run(randomUUID(), planId, rackName, '', rackName, textValue(point.equipmentType), xRatio, yRatio);
    }

    db.prepare(`
      UPDATE admin_db_assets
         SET floor_plan_id = ?, station_name = ?, file_name = ?, mime_type = ?, file_size = ?,
             record_count = 1, coordinates_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(
      planId,
      stationName,
      fileName,
      imageDataUrl ? optionalText(req.body?.mimeType, 100) : optionalText(asset.mime_type, 100),
      fileSize,
      JSON.stringify(coordinates),
      req.params.id
    );
    db.prepare(`
      INSERT INTO db_upload_history (id, db_type, file_name, file_size, record_count, uploaded_by, status, message)
      VALUES (?, 'floor_plan', ?, ?, 1, ?, 'success', '국사 평면도 수정')
    `).run(randomUUID(), fileName, fileSize, authUser(req).id);
    db.exec('COMMIT');
    if (imageDataUrl && previousObjectKey && previousObjectKey !== objectKey) await removeFloorPlanObject(previousObjectKey);
    success(res, { id: req.params.id, updated: true });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}));

router.delete('/db/assets/:id', asyncRoute(async (req, res) => {
  const asset = db.prepare('SELECT db_type, floor_plan_id, station_name, file_name FROM admin_db_assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as { db_type: string; floor_plan_id: string | null; station_name: string; file_name: string } | undefined;
  const result = db.prepare('UPDATE admin_db_assets SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '등록 DB를 찾을 수 없습니다.', 'NOT_FOUND');
  if (asset?.db_type === 'floor_plan') {
    const plan = db.prepare('SELECT id, object_key FROM catv_floor_plans WHERE id = ?').get(asset.floor_plan_id || req.params.id) as { id: string; object_key: string | null } | undefined;
    if (plan) {
      await removeFloorPlanObject(plan.object_key);
      db.prepare('DELETE FROM catv_floor_plans WHERE id = ?').run(plan.id);
    }
  } else if (asset?.db_type === 'b2c') {
    const stationKey = normalizeStationName(asset.station_name);
    db.prepare('DELETE FROM catv_b2c_lines WHERE station_key = ?').run(stationKey);
    deleteStraightMapsForStation(stationKey);
  }
  success(res, { id: req.params.id, deleted: true });
}));

router.delete('/db/assets', asyncRoute(async (req, res) => {
  const dbType = typeof req.query.type === 'string' ? req.query.type : '';
  if (!allowedAssetTypes.has(dbType)) throw new ApiError(400, 'DB 자산 종류를 확인해주세요.', 'VALIDATION_ERROR');
  const result = db.prepare('UPDATE admin_db_assets SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE db_type = ? AND deleted_at IS NULL').run(dbType);
  if (dbType === 'floor_plan') {
    const plans = db.prepare('SELECT object_key FROM catv_floor_plans').all() as Array<{ object_key: string | null }>;
    for (const plan of plans) await removeFloorPlanObject(plan.object_key);
    db.prepare('DELETE FROM catv_floor_plans').run();
  } else {
    db.prepare('DELETE FROM catv_b2c_lines').run();
    deleteAllStraightMaps();
  }
  success(res, { dbType, deletedCount: result.changes });
}));

router.post('/straight-maps/upload-url', asyncRoute(async (req, res) => {
  const result = await createStraightMapUpload({
    sourceSha256: asText(req.body?.sourceSha256, 'sourceSha256', 64),
    filename: asText(req.body?.filename, 'filename', 255),
    size: Number(req.body?.size),
    contentType: typeof req.body?.contentType === 'string' ? req.body.contentType : '',
    stationName: asText(req.body?.stationName, 'stationName', 100),
    requestedBy: authUser(req).id,
  });
  success(res, result, 201);
}));

router.put('/straight-maps/local-uploads/:jobId', asyncRoute(async (req, res) => {
  const rawLength = req.get('content-length');
  const declaredLength = rawLength ? Number(rawLength) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength <= 0)) {
    throw new ApiError(400, '업로드 파일 크기를 확인할 수 없습니다.', 'INVALID_SOURCE_SIZE');
  }
  success(res, await storeLocalStraightMapUpload(req.params.jobId, authUser(req).id, req, declaredLength));
}));

router.post('/straight-maps/uploads/:jobId/complete', asyncRoute(async (req, res) => {
  success(res, await completeStraightMapUpload(req.params.jobId, authUser(req).id));
}));

router.get('/straight-maps/jobs', (_req, res) => success(res, listStraightMapJobs()));
router.post('/straight-maps/jobs/:jobId/retry', (req, res) => success(res, retryStraightMapJob(req.params.jobId)));
router.post('/straight-maps/jobs/:jobId/cancel', (req, res) => success(res, cancelStraightMapJob(req.params.jobId)));
router.delete('/straight-maps/jobs/:jobId', (req, res) => success(res, deleteStraightMapJob(req.params.jobId)));
router.post('/straight-maps/versions/:versionId/rollback', (req, res) => success(res, rollbackStraightMapVersion(req.params.versionId)));

export default router;
