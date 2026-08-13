import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { mapCatvCellRow } from '../catv';
import { deleteCatvCell, upsertCatvCellRecord } from '../catv-store';
import { ApiError, asText, asyncRoute, optionalText, success } from '../http';
import { mapCellRow, mapDailyWorkRow, mapMaterialUsageRow } from '../mappers';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { privatePhotoMime, removePrivatePhoto, resolvePrivatePhoto, savePrivatePhoto } from '../photo-storage';
import { writeAuditLog } from '../security/audit';
import fs from 'node:fs';

const router = Router();
router.use(requireAuth);

const cellSelect = `
  SELECT c.*, s.site_name, s.site_code
    FROM cells c
    LEFT JOIN sites s ON s.id = c.site_id
   WHERE c.deleted_at IS NULL
`;

router.get('/search', (req, res) => {
  if (typeof req.query.q === 'string') {
    const query = req.query.q.trim();
    if (!query) throw new ApiError(400, 'CELL명을 입력해주세요.', 'VALIDATION_ERROR');
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const rows = db.prepare(`
      SELECT * FROM catv_cells
       WHERE cell_name LIKE ? ESCAPE '\\'
          OR key_number LIKE ? ESCAPE '\\'
          OR station_name LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN lower(cell_name) = lower(?) THEN 0 ELSE 1 END,
                cell_name, station_name
       LIMIT 50
    `).all(pattern, pattern, pattern, query) as Array<Record<string, unknown>>;
    success(res, { items: rows.map(mapCatvCellRow), total: rows.length });
    return;
  }
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const pattern = `%${name.replace(/[\\%_]/g, '\\$&')}%`;
  const where = name
    ? ` AND (c.cell_name LIKE ? ESCAPE '\\' OR c.cell_code LIKE ? ESCAPE '\\' OR c.node_name LIKE ? ESCAPE '\\')`
    : '';
  const params = name ? [pattern, pattern, pattern] : [];

  const rows = db.prepare(`${cellSelect}${where} ORDER BY c.cell_name LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>;
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS count FROM cells c WHERE c.deleted_at IS NULL ${where}
  `).get(...params) as { count: number };

  success(res, {
    items: rows.map(mapCellRow),
    pagination: { page, limit, total: totalRow.count, totalPages: Math.ceil(totalRow.count / limit) },
  });
});

router.get('/:id/transmission', (req, res) => {
  const row = db.prepare(`
    SELECT cc.*, c.status
      FROM catv_cells cc
      LEFT JOIN cells c ON c.id = cc.id AND c.deleted_at IS NULL
     WHERE cc.id = ?
  `).get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, 'CELL 전송망 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  const historyRows = db.prepare(`
    SELECT * FROM cell_work_history
     WHERE cell_id = ? AND deleted_at IS NULL
     ORDER BY work_date DESC, created_at DESC
  `).all(req.params.id) as Array<Record<string, unknown>>;

  success(res, {
    ...mapCatvCellRow(row),
    status: String(row.status || '정상'),
    history: historyRows.map((history) => ({
      id: String(history.id),
      title: history.title || undefined,
      type: String(history.work_type),
      date: String(history.work_date),
      worker: String(history.worker_name),
      summary: String(history.summary),
      status: history.status || undefined,
      photos: JSON.parse(String(history.photos_json || '[]')),
    })),
  });
});

router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const rows = db.prepare(`${cellSelect} ORDER BY c.cell_name LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>;
  const total = (db.prepare('SELECT COUNT(*) AS count FROM cells WHERE deleted_at IS NULL').get() as { count: number }).count;
  success(res, { items: rows.map(mapCellRow), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${cellSelect} AND c.id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');

  const site = row.site_id
    ? db.prepare('SELECT * FROM sites WHERE id = ? AND deleted_at IS NULL').get(String(row.site_id))
    : null;
  const transmissionLines = db.prepare(`
    SELECT * FROM transmission_lines WHERE cell_id = ? AND deleted_at IS NULL ORDER BY line_number
  `).all(req.params.id);
  const photoRows = db.prepare(`
    SELECT p.*, u.name AS author_name FROM field_photos p
    LEFT JOIN users u ON u.id = p.uploaded_by
    WHERE p.cell_id = ? AND p.deleted_at IS NULL ORDER BY p.uploaded_at DESC
  `).all(req.params.id) as Array<Record<string, unknown>>;
  const historyRows = db.prepare(`
    SELECT * FROM cell_work_history WHERE cell_id = ? AND deleted_at IS NULL ORDER BY work_date DESC
  `).all(req.params.id) as Array<Record<string, unknown>>;
  const dailyRows = db.prepare(`
    SELECT d.*, u.name AS worker_name, u.department
      FROM daily_work d JOIN users u ON u.id = d.user_id
     WHERE d.cell_id = ? AND d.deleted_at IS NULL ORDER BY d.work_date DESC LIMIT 100
  `).all(req.params.id) as Array<Record<string, unknown>>;
  const usageRows = db.prepare(`
    SELECT mu.*, m.material_name, u.name AS worker_name, c.cell_name
      FROM material_usage mu
      JOIN materials m ON m.id = mu.material_id
      JOIN users u ON u.id = mu.user_id
      LEFT JOIN cells c ON c.id = mu.cell_id
     WHERE mu.cell_id = ? ORDER BY mu.usage_date DESC LIMIT 100
  `).all(req.params.id) as Array<Record<string, unknown>>;

  const cell = mapCellRow(row);
  cell.photos = photoRows.map((photo) => {
    const memo = JSON.parse(String(photo.memo || '{}')) as Record<string, string>;
    return {
      id: String(photo.id),
      title: String(photo.file_name),
      category: memo.category || '국사설비',
      date: String(photo.uploaded_at),
      author: String(photo.author_name || '관리자'),
      url: String(photo.file_url).startsWith('photos/')
        ? `/api/cells/${encodeURIComponent(req.params.id)}/photos/${encodeURIComponent(String(photo.id))}/content`
        : String(photo.file_url),
      description: memo.description || '',
    };
  });
  cell.history = historyRows.map((history) => ({
    id: String(history.id),
    title: history.title || undefined,
    type: String(history.work_type),
    date: String(history.work_date),
    worker: String(history.worker_name),
    summary: String(history.summary),
    status: history.status || undefined,
    photos: JSON.parse(String(history.photos_json || '[]')),
  }));

  success(res, {
    cell,
    site,
    transmissionLines,
    photos: cell.photos,
    dailyWork: dailyRows.map(mapDailyWorkRow),
    materialUsage: usageRows.map(mapMaterialUsageRow),
  });
});

router.post('/', requireRoles('admin'), (req, res) => {
  const id = randomUUID();
  const cellName = asText(req.body?.cellName, 'CELL명', 100);
  const cellCode = asText(req.body?.cellCode || cellName, 'CELL 코드', 100);
  const nodeName = asText(req.body?.nodeName, '노드명', 100);
  const address = asText(req.body?.address, '주소', 300);
  const region = asText(req.body?.region, '권역', 80);
  const status = optionalText(req.body?.status, 30) || '정상';
  const memo = optionalText(req.body?.memo, 2000);

  db.prepare(`
    INSERT INTO cells (
      id, cell_name, cell_code, node_name, site_id, line_code, address, region,
      status, memo, responsible_team, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cellName,
    cellCode,
    nodeName,
    req.body?.siteId || null,
    req.body?.lineCode || cellCode,
    address,
    region,
    status,
    memo,
    req.body?.responsibleTeam || '',
    JSON.stringify(req.body)
  );
  upsertCatvCellRecord(req.body as Record<string, unknown>, id);
  success(res, { id }, 201);
});

router.put('/:id', requireRoles('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM cells WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  const saved = JSON.parse(String(existing.details_json || '{}')) as Record<string, unknown>;
  const merged = { ...saved, ...req.body, id: req.params.id };
  db.prepare(`
    UPDATE cells SET cell_name = ?, cell_code = ?, node_name = ?, site_id = ?, line_code = ?,
      address = ?, region = ?, status = ?, memo = ?, responsible_team = ?, details_json = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    req.body?.cellName || existing.cell_name,
    req.body?.cellCode || existing.cell_code,
    req.body?.nodeName || existing.node_name,
    req.body?.siteId ?? existing.site_id,
    req.body?.lineCode || existing.line_code,
    req.body?.address || existing.address,
    req.body?.region || existing.region,
    req.body?.status || existing.status,
    req.body?.memo ?? existing.memo,
    req.body?.responsibleTeam || existing.responsible_team,
    JSON.stringify(merged),
    req.params.id
  );
  upsertCatvCellRecord(merged, req.params.id);
  success(res, { id: req.params.id });
});

router.delete('/:id', requireRoles('admin'), (req, res) => {
  const result = db.prepare(`
    UPDATE cells SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  deleteCatvCell(req.params.id);
  success(res, { id: req.params.id, deleted: true });
});

router.post('/:id/photos', (req, res) => {
  const user = authUser(req);
  const cell = db.prepare('SELECT id FROM cells WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!cell) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  const id = randomUUID();
  const fileName = asText(req.body?.title || req.body?.fileName, '사진 제목', 160);
  const dataUrl = asText(req.body?.url || req.body?.fileUrl, '사진 데이터', 15 * 1024 * 1024);
  const stored = savePrivatePhoto(dataUrl);
  try {
    db.prepare(`
      INSERT INTO field_photos (
        id, cell_id, work_id, file_name, file_url, file_type, uploaded_by, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.params.id,
      req.body?.workId || null,
      fileName,
      stored.objectKey,
      stored.mimeType,
      user.id,
      JSON.stringify({ category: req.body?.category || '국사설비', description: req.body?.description || '' })
    );
  } catch (error) {
    removePrivatePhoto(stored.objectKey);
    throw error;
  }
  writeAuditLog(req, {
    action: 'PHOTO_UPLOADED',
    targetType: 'field_photo',
    targetId: id,
    metadata: { cellId: req.params.id, mimeType: stored.mimeType, size: stored.size },
  });
  success(res, { id }, 201);
});

router.get('/:id/photos/:photoId/content', (req, res) => {
  const photo = db.prepare(`
    SELECT file_url FROM field_photos
     WHERE id = ? AND cell_id = ? AND deleted_at IS NULL
  `).get(req.params.photoId, req.params.id) as { file_url: string } | undefined;
  if (!photo || !photo.file_url.startsWith('photos/')) throw new ApiError(404, '사진을 찾을 수 없습니다.', 'NOT_FOUND');
  const absolutePath = resolvePrivatePhoto(photo.file_url);
  if (!fs.existsSync(absolutePath)) throw new ApiError(404, '사진 파일을 찾을 수 없습니다.', 'NOT_FOUND');
  res.setHeader('Content-Type', privatePhotoMime(photo.file_url));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(absolutePath);
});

router.delete('/:id/photos/:photoId', requireRoles('admin'), (req, res) => {
  const photo = db.prepare(`
    SELECT file_url FROM field_photos
     WHERE id = ? AND cell_id = ? AND deleted_at IS NULL
  `).get(req.params.photoId, req.params.id) as { file_url: string } | undefined;
  if (!photo) throw new ApiError(404, '사진을 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('UPDATE field_photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND cell_id = ?')
    .run(req.params.photoId, req.params.id);
  removePrivatePhoto(photo.file_url);
  writeAuditLog(req, { action: 'PHOTO_DELETED', targetType: 'field_photo', targetId: req.params.photoId, metadata: { cellId: req.params.id } });
  success(res, { id: req.params.photoId, deleted: true });
});

router.post('/:id/history', (req, res) => {
  const user = authUser(req);
  const cell = db.prepare('SELECT id FROM cells WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!cell) throw new ApiError(404, 'CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cell_work_history (
      id, cell_id, title, work_type, work_date, worker_name, summary, status, photos_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.params.id,
    optionalText(req.body?.title, 200),
    asText(req.body?.type, '작업유형', 100),
    asText(req.body?.date, '작업일자', 30),
    user.role === 'admin' || user.role === 'team_leader' ? asText(req.body?.worker, '작업자', 100) : user.name,
    asText(req.body?.summary, '작업내용', 3000),
    req.body?.status || '완료',
    JSON.stringify(Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 3) : [])
  );
  writeAuditLog(req, { action: 'CELL_HISTORY_CREATED', targetType: 'cell_history', targetId: id, metadata: { cellId: req.params.id } });
  success(res, { id }, 201);
});

router.put('/:id/history/:historyId', (req, res) => {
  const user = authUser(req);
  const existing = db.prepare(`
    SELECT * FROM cell_work_history WHERE id = ? AND cell_id = ? AND deleted_at IS NULL
  `).get(req.params.historyId, req.params.id) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, '작업이력을 찾을 수 없습니다.', 'NOT_FOUND');
  if (user.role !== 'admin' && user.role !== 'team_leader' && String(existing.worker_name) !== user.name) {
    throw new ApiError(403, '이 작업이력을 수정할 권한이 없습니다.', 'FORBIDDEN');
  }
  db.prepare(`
    UPDATE cell_work_history SET title = ?, work_type = ?, work_date = ?, worker_name = ?,
      summary = ?, status = ?, photos_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    req.body?.title ?? existing.title,
    req.body?.type || existing.work_type,
    req.body?.date || existing.work_date,
    user.role === 'admin' || user.role === 'team_leader' ? req.body?.worker || existing.worker_name : existing.worker_name,
    req.body?.summary || existing.summary,
    req.body?.status || existing.status,
    req.body?.photos ? JSON.stringify(req.body.photos.slice(0, 3)) : String(existing.photos_json),
    req.params.historyId
  );
  writeAuditLog(req, { action: 'CELL_HISTORY_UPDATED', targetType: 'cell_history', targetId: req.params.historyId, metadata: { cellId: req.params.id } });
  success(res, { id: req.params.historyId });
});

router.delete('/:id/history/:historyId', (req, res) => {
  const user = authUser(req);
  const existing = db.prepare(`
    SELECT worker_name FROM cell_work_history WHERE id = ? AND cell_id = ? AND deleted_at IS NULL
  `).get(req.params.historyId, req.params.id) as { worker_name: string } | undefined;
  if (!existing) throw new ApiError(404, '작업이력을 찾을 수 없습니다.', 'NOT_FOUND');
  if (user.role !== 'admin' && user.role !== 'team_leader' && existing.worker_name !== user.name) {
    throw new ApiError(403, '이 작업이력을 삭제할 권한이 없습니다.', 'FORBIDDEN');
  }
  const result = db.prepare(`
    UPDATE cell_work_history SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND cell_id = ? AND deleted_at IS NULL
  `).run(req.params.historyId, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '작업이력을 찾을 수 없습니다.', 'NOT_FOUND');
  writeAuditLog(req, { action: 'CELL_HISTORY_DELETED', targetType: 'cell_history', targetId: req.params.historyId, metadata: { cellId: req.params.id } });
  success(res, { id: req.params.historyId, deleted: true });
});

export default router;
