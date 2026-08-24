import { Router, type Response } from 'express';
import { db } from '../db';
import { INITIAL_CATV_MANPOWER } from '../../src/data/mockData';
import type { CatvManpowerStatus } from '../../src/types';
import { ApiError, success } from '../http';
import { authUser, requireAuth, requireRoles } from '../security/session';

const router = Router();
router.use(requireAuth);

type StoredRow = { payload_json: string; version: number; updated_at: string };
type ManpowerEnvelope = { status: CatvManpowerStatus; version: number; updatedAt: string };
const listeners = new Set<Response>();

const readStatus = (): ManpowerEnvelope => {
  const row = db.prepare('SELECT payload_json, version, updated_at FROM catv_manpower_status WHERE id = 1').get() as StoredRow | undefined;
  if (!row) return { status: INITIAL_CATV_MANPOWER, version: 0, updatedAt: INITIAL_CATV_MANPOWER.lastUpdated };
  try {
    return { status: JSON.parse(row.payload_json) as CatvManpowerStatus, version: row.version, updatedAt: row.updated_at };
  } catch {
    return { status: INITIAL_CATV_MANPOWER, version: row.version, updatedAt: row.updated_at };
  }
};

const nonNegativeInteger = (value: unknown, field: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new ApiError(400, `${field} 값이 올바르지 않습니다.`, 'VALIDATION_ERROR');
  }
  return parsed;
};

const validateStatus = (input: unknown): CatvManpowerStatus => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, '인력현황 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.regions) || !value.regions.length || value.regions.length > 20) {
    throw new ApiError(400, '권역별 인력현황이 필요합니다.', 'VALIDATION_ERROR');
  }
  const regionIds = new Set<string>();
  const regions = value.regions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, `${index + 1}번째 권역 형식이 올바르지 않습니다.`, 'VALIDATION_ERROR');
    const region = item as Record<string, unknown>;
    const text = (field: string, max: number) => {
      const result = typeof region[field] === 'string' ? region[field].trim() : '';
      if (!result || result.length > max) throw new ApiError(400, `${index + 1}번째 권역의 ${field} 값이 올바르지 않습니다.`, 'VALIDATION_ERROR');
      return result;
    };
    const id = text('id', 100);
    if (regionIds.has(id)) throw new ApiError(400, '권역 ID가 중복되었습니다.', 'VALIDATION_ERROR');
    regionIds.add(id);
    return {
      id,
      regionName: text('regionName', 100),
      headcount: nonNegativeInteger(region.headcount, '현장 인원'),
      aerialVehicles: nonNegativeInteger(region.aerialVehicles, '고소작업차'),
      passengerVehicles: nonNegativeInteger(region.passengerVehicles, '승용차'),
      baseLocation: typeof region.baseLocation === 'string' ? region.baseLocation.trim().slice(0, 200) : undefined,
    };
  });
  const management = value.management;
  if (!management || typeof management !== 'object' || Array.isArray(management)) throw new ApiError(400, '관리인력 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
  const managementValue = management as Record<string, unknown>;
  return {
    regions,
    management: {
      director: nonNegativeInteger(managementValue.director, '소장 인원'),
      generalManager: nonNegativeInteger(managementValue.generalManager, '총괄팀장 인원'),
      adminTeam: nonNegativeInteger(managementValue.adminTeam, '행정팀 인원'),
    },
    lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated.trim().slice(0, 100) : '',
  };
};

const publish = (value: ManpowerEnvelope) => {
  const message = `event: manpower\ndata: ${JSON.stringify(value)}\n\n`;
  for (const response of listeners) response.write(message);
};

router.get('/', (_req, res) => success(res, readStatus()));

router.put('/', requireRoles('public_official', 'team_leader', 'admin'), (req, res) => {
  const status = validateStatus(req.body);
  const user = authUser(req);
  db.prepare(`
    INSERT INTO catv_manpower_status (id, payload_json, version, updated_at, updated_by)
    VALUES (1, ?, 1, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      version = catv_manpower_status.version + 1,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = excluded.updated_by
  `).run(JSON.stringify(status), user.id);
  const updated = readStatus();
  publish(updated);
  success(res, updated);
});

router.get('/events', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: manpower\ndata: ${JSON.stringify(readStatus())}\n\n`);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  listeners.add(res);
  req.on('close', () => {
    clearInterval(keepAlive);
    listeners.delete(res);
  });
});

export default router;
