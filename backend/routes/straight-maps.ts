import fs from 'node:fs';
import { Router } from 'express';
import { db } from '../db';
import { normalizeStationName } from '../catv';
import { ApiError, asyncRoute, success } from '../http';
import { requireAuth } from '../security/session';
import { straightMapContinuousTerms, type StraightMapMatchLength } from '../straight-map-search';
import { resolveStraightMapPdf } from '../straight-map-storage';
import { cachedStraightMapSearch } from '../straight-map-cache';
import { readR2Object, usesR2Storage } from '../object-storage';

const router = Router();
router.use(requireAuth);

router.get('/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 255) : '';
  if (!query) throw new ApiError(400, '직선도 검색어를 입력해주세요.', 'VALIDATION_ERROR');
  const requestedLength = Number(req.query.matchLength);
  const matchLength: StraightMapMatchLength = requestedLength === 5 ? 5 : 6;
  const { normalized, terms } = straightMapContinuousTerms(query, matchLength);
  if (!terms.length) throw new ApiError(400, `직선도 검색어는 띄어쓰기를 제외하고 ${matchLength}글자 이상이어야 합니다.`, 'VALIDATION_ERROR');
  const stationKey = typeof req.query.station === 'string' ? normalizeStationName(req.query.station) : '';
  const mapKey = typeof req.query.map === 'string' ? normalizeStationName(req.query.map) : '';
  const cacheKey = `${normalized}|${matchLength}|${stationKey}|${mapKey}`;
  const rows = cachedStraightMapSearch(cacheKey, () => {
    const stationWhere = stationKey ? 'AND selected.station_key = ?' : '';
    const mapWhere = mapKey ? 'AND selected.map_key = ?' : '';
    const escaped = (value: string) => value.replace(/[\\%_]/g, '\\$&');
    const fullPattern = `%${escaped(normalized)}%`;
    const patterns = terms.map((term) => `%${escaped(term)}%`);
    const termWhere = patterns.map(() => "o.compact_text LIKE ? ESCAPE '\\'").join(' OR ');
    const params: Array<string | number | null> = [normalized, fullPattern, ...patterns];
    if (stationKey) params.push(stationKey);
    if (mapKey) params.push(mapKey);
    params.push(50);
    return db.prepare(`
      WITH ranked_versions AS (
        SELECT v.*,
               ROW_NUMBER() OVER (
                 PARTITION BY v.map_id
                 ORDER BY CASE v.status WHEN 'ACTIVE' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END, v.version DESC
               ) AS selected_rank
          FROM map_versions v
         WHERE v.status IN ('ACTIVE', 'PROCESSING')
      ), selected AS (
        SELECT * FROM ranked_versions WHERE selected_rank = 1
      )
      SELECT o.id, o.map_id AS mapId, selected.map_name AS mapName,
             selected.version AS mapVersion, selected.status AS mapStatus,
             o.original_text AS label, o.object_type AS objectType,
             o.x_ratio AS xRatio, o.y_ratio AS yRatio,
             o.width_points AS widthPoints, o.height_points AS heightPoints,
             o.page_index AS pageIndex, o.page_x_points AS pageXPoints, o.page_y_points AS pageYPoints,
             o.world_x_points AS worldXPoints, o.world_y_points AS worldYPoints,
             CASE
               WHEN o.compact_text = ? THEN 1
               WHEN o.compact_text LIKE ? ESCAPE '\\' THEN 2
               ELSE 3
             END AS matchRank
        FROM map_objects o JOIN selected ON selected.id = o.version_id
       WHERE (${termWhere})
         ${stationWhere}
         ${mapWhere}
       ORDER BY matchRank, length(o.compact_text), selected.map_name, o.shape_id
       LIMIT ?
    `).all(...params);
  }) as Array<Record<string, unknown>>;
  success(res, { count: rows.length, results: rows });
});

router.get('/:mapId', asyncRoute(async (req, res) => {
  const version = db.prepare(`
    SELECT map_id AS mapId, map_name AS mapName, version, status, artifact_set_id AS artifactSetId,
           render_mode AS renderMode, world_width_points AS worldWidthPoints,
           world_height_points AS worldHeightPoints, page_count AS pageCount,
           content_bounds_json AS contentBoundsJson, manifest_json AS manifestJson,
           error_message AS errorMessage
      FROM map_versions
     WHERE map_id = ? AND status IN ('ACTIVE', 'PROCESSING')
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, version DESC LIMIT 1
  `).get(req.params.mapId) as Record<string, unknown> | undefined;
  if (!version) throw new ApiError(404, '등록된 직선도 지도가 없습니다.', 'STRAIGHT_MAP_NOT_FOUND');
  if (version.status === 'PROCESSING') throw new ApiError(409, '직선도 지도를 생성 중입니다.', 'STRAIGHT_MAP_PROCESSING');
  const manifest = JSON.parse(String(version.manifestJson || '{}')) as { pagePlacements?: unknown[] };
  const pdfUrl = `/api/straight-maps/${encodeURIComponent(String(version.mapId))}/versions/${version.version}/pdf`;
  success(res, { ...version, artifactSetId: undefined, contentBounds: JSON.parse(String(version.contentBoundsJson || '{}')),
    pagePlacements: manifest.pagePlacements || [],
    pdfUrl, pdfRequiresCredentials: true,
    manifestJson: undefined, contentBoundsJson: undefined });
}));

router.get('/:mapId/versions/:version/pdf', asyncRoute(async (req, res) => {
  const version = Number(req.params.version);
  const allowed = db.prepare(`
    SELECT artifact_set_id AS artifactSetId FROM map_versions
     WHERE map_id = ? AND version = ? AND status IN ('ACTIVE', 'ARCHIVED')
  `).get(req.params.mapId, version) as { artifactSetId: string | null } | undefined;
  if (!allowed?.artifactSetId) throw new ApiError(404, '직선도 PDF를 찾을 수 없습니다.', 'PDF_NOT_FOUND');
  if (usesR2Storage) {
    const object = await readR2Object(`line-diagrams/v3/documents/${allowed.artifactSetId}/map.pdf`);
    const rangeHeader = req.get('range');
    let start = 0;
    let end = object.body.length - 1;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
      if (!match) {
        res.setHeader('Content-Range', `bytes */${object.body.length}`);
        res.sendStatus(416);
        return;
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.setHeader('Content-Range', `bytes */${object.body.length}`);
          res.sendStatus(416);
          return;
        }
        start = Math.max(0, object.body.length - suffixLength);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= object.body.length) {
        res.setHeader('Content-Range', `bytes */${object.body.length}`);
        res.sendStatus(416);
        return;
      }
    }
    const body = object.body.subarray(start, end + 1);
    res.status(rangeHeader ? 206 : 200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', body.length);
    res.setHeader('Accept-Ranges', 'bytes');
    if (rangeHeader) res.setHeader('Content-Range', `bytes ${start}-${end}/${object.body.length}`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(body);
    return;
  }
  const filePath = resolveStraightMapPdf(allowed.artifactSetId);
  if (!fs.existsSync(filePath)) throw new ApiError(404, '직선도 PDF를 찾을 수 없습니다.', 'PDF_NOT_FOUND');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(filePath);
}));

export default router;
