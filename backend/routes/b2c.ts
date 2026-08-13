import { Router } from 'express';
import { db } from '../db';
import { mapB2CRow, normalizeStationName } from '../catv';
import { ApiError, success } from '../http';
import { requireAuth } from '../security/session';
import { normalizeB2CSearchText } from '../b2c-search';

const router = Router();
router.use(requireAuth);

const stationAddressFor = (stationName: string) => {
  const key = normalizeStationName(stationName);
  const rows = db.prepare(`
    SELECT station_name, station_address FROM catv_cells
     WHERE station_address <> '' ORDER BY updated_at DESC
  `).all() as Array<{ station_name: string; station_address: string }>;
  return rows.find((row) => normalizeStationName(row.station_name) === key)?.station_address || '';
};

router.get('/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) throw new ApiError(400, 'B2C 전용선 주소 또는 명칭을 입력해주세요.', 'VALIDATION_ERROR');
  const normalized = normalizeB2CSearchText(query.slice(0, 100));
  if (!normalized) throw new ApiError(400, 'B2C 검색어를 입력해주세요.', 'VALIDATION_ERROR');
  const pattern = `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT * FROM catv_b2c_lines
     WHERE normalized_search LIKE ? ESCAPE '\\'
     ORDER BY CASE WHEN normalized_search = ? THEN 0 ELSE 1 END,
              station_name, node, CAST(core AS INTEGER), service_name
     LIMIT 100
  `).all(pattern, normalized) as Array<Record<string, unknown>>;
  success(res, {
    items: rows.map((row) => mapB2CRow(row, stationAddressFor(String(row.station_name || '')))),
    total: rows.length,
  });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM catv_b2c_lines WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, 'B2C 전용선 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, mapB2CRow(row, stationAddressFor(String(row.station_name || ''))));
});

export default router;
