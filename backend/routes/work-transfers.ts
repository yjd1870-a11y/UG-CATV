import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { db } from '../db';
import { ApiError, asText, asyncRoute, optionalText, success } from '../http';
import { mapTransferRow } from '../mappers';
import {
  privatePhotoDownloadUrl,
  privatePhotoMime,
  removePrivatePhoto,
  resolvePrivatePhoto,
  savePrivatePhoto,
} from '../photo-storage';
import { authUser, type AuthUser, requireAuth, requireRoles } from '../security/session';
import { writeAuditLog } from '../security/audit';
import { usesR2Storage } from '../object-storage';
import { workTransferRegionParams, workTransferRegionPlaceholders } from '../work-transfer-policy';

const router = Router();
router.use(requireAuth);

const transferSelect = `
  SELECT wt.*, c.cell_name, COALESCE(r.region_name, c.region) AS region_name,
         field_user.name AS field_processed_by_name,
         completed_user.name AS final_completed_by_name
    FROM work_transfers wt
    LEFT JOIN cells c ON c.id = wt.cell_id
    LEFT JOIN regions r ON r.id = wt.region_id
    LEFT JOIN users field_user ON field_user.id = wt.field_processed_by
    LEFT JOIN users completed_user ON completed_user.id = wt.final_completed_by
   WHERE wt.deleted_at IS NULL
`;

const globalRoles = new Set(['admin', 'public_official']);
const registrationRoles = new Set(['admin', 'public_official', 'team_leader']);
const completionRoles = new Set(['admin', 'public_official', 'team_leader']);
const workflowStatuses = new Set(['registered', 'field_processed', 'completed']);
const allowedAttachmentTypes = new Set(['request_photo', 'field_photo']);
const maxEvidencePhotos = 3;

type StoredAttachment = { id: string; file_url: string };

const storedAttachments = (transferId: string) => db.prepare(`
  SELECT id, file_url FROM work_transfer_attachments WHERE transfer_id = ?
`).all(transferId) as StoredAttachment[];

const removeStoredAttachmentFiles = async (attachments: StoredAttachment[]) => {
  try {
    for (const attachment of attachments) await removePrivatePhoto(attachment.file_url);
  } catch {
    throw new ApiError(
      503,
      '첨부사진을 완전히 삭제하지 못해 완료 처리를 중단했습니다. 잠시 후 다시 시도해 주세요.',
      'PHOTO_PURGE_FAILED',
    );
  }
};

const requireRegion = (user: AuthUser) => {
  if (user.regionId) return user.regionId;
  throw new ApiError(403, '계정에 담당 지역이 지정되지 않았습니다. 관리자에게 문의해 주세요.', 'REGION_REQUIRED');
};

const scopeSql = (user: AuthUser, alias = 'wt') => {
  if (globalRoles.has(user.role)) return { sql: '', params: [] as Array<string | number> };
  const regionId = requireRegion(user);
  const completedRule = user.role === 'manager' || user.role === 'guest' ? ` AND ${alias}.workflow_status <> 'completed'` : '';
  return { sql: ` AND ${alias}.region_id = ?${completedRule}`, params: [regionId] as Array<string | number> };
};

const assertRegionPermission = (user: AuthUser, regionId: string) => {
  if (globalRoles.has(user.role)) return;
  if (requireRegion(user) !== regionId) throw new ApiError(404, '업무이관 정보를 찾을 수 없습니다.', 'NOT_FOUND');
};

const regionById = (regionId: string) => {
  const region = db.prepare(`
    SELECT id, region_name FROM regions
     WHERE id = ? AND active = 1 AND region_name IN (${workTransferRegionPlaceholders})
  `).get(regionId, ...workTransferRegionParams) as { id: string; region_name: string } | undefined;
  if (!region) throw new ApiError(400, '업무이관 지역은 평택안성, 용인, 수원, 오산화성만 선택할 수 있습니다.', 'INVALID_REGION');
  return region;
};

const accessibleTransfer = (id: string, user: AuthUser) => {
  const scope = scopeSql(user);
  const row = db.prepare(`${transferSelect}${scope.sql} AND wt.id = ?`).get(...scope.params, id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, '업무이관 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  return row;
};

const mapRows = (rows: Array<Record<string, unknown>>) => rows.map(mapTransferRow);

const normalizeDate = (value: unknown, field: string) => {
  const text = optionalText(value, 40);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) {
    throw new ApiError(400, `${field} 형식이 올바르지 않습니다.`, 'VALIDATION_ERROR');
  }
  return text;
};

const normalizeDay = (value: unknown, field: string) => {
  const text = normalizeDate(value, field);
  if (!text) return null;
  const day = text.slice(0, 10);
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
    throw new ApiError(400, `${field} 형식이 올바르지 않습니다.`, 'VALIDATION_ERROR');
  }
  return day;
};

const listFilters = (req: Request, user: AuthUser) => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status) {
    if (!workflowStatuses.has(status)) throw new ApiError(400, '허용되지 않은 상태입니다.', 'VALIDATION_ERROR');
    clauses.push('wt.workflow_status = ?');
    params.push(status);
  }
  const requestedRegion = typeof req.query.regionId === 'string' ? req.query.regionId : '';
  if (requestedRegion) {
    assertRegionPermission(user, requestedRegion);
    clauses.push('wt.region_id = ?');
    params.push(requestedRegion);
  }
  const from = normalizeDate(req.query.from, '시작일');
  const to = normalizeDate(req.query.to, '종료일');
  if (from) { clauses.push('date(COALESCE(wt.inspection_requested_date, wt.transfer_date)) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(COALESCE(wt.inspection_requested_date, wt.transfer_date)) <= date(?)'); params.push(to); }
  if (req.query.urgent === 'true' || req.query.urgent === 'false') {
    clauses.push('wt.is_urgent = ?');
    params.push(req.query.urgent === 'true' ? 1 : 0);
  }
  const fieldProcessorId = typeof req.query.fieldProcessorId === 'string' ? req.query.fieldProcessorId.trim() : '';
  if (fieldProcessorId === 'unassigned') {
    clauses.push('wt.field_processed_by IS NULL');
  } else if (fieldProcessorId) {
    clauses.push('wt.field_processed_by = ?');
    params.push(fieldProcessorId);
  }
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  if (query) {
    clauses.push(`(wt.branch_name LIKE ? OR wt.customer_address LIKE ? OR wt.inspection_company LIKE ?
      OR wt.media_type LIKE ? OR COALESCE(r.region_name, '') LIKE ?
      OR EXISTS (SELECT 1 FROM work_transfer_field_actions fa WHERE fa.transfer_id = wt.id AND (fa.action_text LIKE ? OR fa.processed_by_name LIKE ?)))`);
    const like = `%${query}%`;
    params.push(...Array.from({ length: 7 }, () => like));
  }
  const scope = scopeSql(user);
  return { sql: `${scope.sql}${clauses.length ? ` AND ${clauses.join(' AND ')}` : ''}`, params: [...scope.params, ...params] };
};

router.get('/meta', (req, res) => {
  const user = authUser(req);
  const rows = globalRoles.has(user.role)
    ? db.prepare(`
      SELECT id, region_name AS name FROM regions
       WHERE active = 1 AND region_name IN (${workTransferRegionPlaceholders})
       ORDER BY CASE region_name WHEN '평택안성' THEN 1 WHEN '용인' THEN 2 WHEN '수원' THEN 3 WHEN '오산화성' THEN 4 END
    `).all(...workTransferRegionParams)
    : db.prepare(`
      SELECT id, region_name AS name FROM regions
       WHERE id = ? AND active = 1 AND region_name IN (${workTransferRegionPlaceholders})
    `).all(requireRegion(user), ...workTransferRegionParams);
  success(res, { regions: rows, currentRegionId: user.regionId, currentRegionName: user.regionName });
});

router.get('/summary', (req, res) => {
  const user = authUser(req);
  const filters = listFilters(req, user);
  const rows = db.prepare(`
    SELECT wt.workflow_status AS status, COUNT(*) AS count
      FROM work_transfers wt
     WHERE wt.deleted_at IS NULL${filters.sql}
     GROUP BY wt.workflow_status
  `).all(...filters.params) as Array<{ status: string; count: number }>;
  const counts = { registered: 0, field_processed: 0, completed: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.count);
  success(res, counts);
});

router.post('/ocr-preview', (req, _res) => {
  const user = authUser(req);
  if (!registrationRoles.has(user.role)) throw new ApiError(403, 'OCR 등록을 수행할 권한이 없습니다.', 'FORBIDDEN');
  throw new ApiError(410, 'OCR은 사진을 서버로 보내지 않고 브라우저에서만 실행됩니다.', 'BROWSER_OCR_ONLY');
});

router.get('/', (req, res) => {
  const user = authUser(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const filters = listFilters(req, user);
  const rows = db.prepare(`${transferSelect}${filters.sql}
    ORDER BY wt.is_urgent DESC, date(COALESCE(wt.inspection_requested_date, wt.transfer_date)) ASC,
             wt.created_at ASC LIMIT ?`
  ).all(...filters.params, limit) as Array<Record<string, unknown>>;
  success(res, mapRows(rows));
});

router.get('/:id', (req, res) => {
  success(res, mapTransferRow(accessibleTransfer(req.params.id, authUser(req))));
});

type PendingPhoto = { fileName: string; dataUrl: string };

router.post('/', asyncRoute(async (req, res) => {
  const user = authUser(req);
  if (!registrationRoles.has(user.role)) throw new ApiError(403, '업무이관을 등록할 권한이 없습니다.', 'FORBIDDEN');
  const regionId = asText(req.body?.regionId, '지역', 100);
  assertRegionPermission(user, regionId);
  const region = regionById(regionId);
  const branchName = asText(req.body?.branchName, '지점', 100);
  const inspectionRequestedDate = normalizeDay(
    req.body?.inspectionRequestedDate || req.body?.inspectionDate || req.body?.requestDate || req.body?.transferDate,
    '점검요청일',
  );
  if (!inspectionRequestedDate) throw new ApiError(400, '점검요청일을 입력해 주세요.', 'VALIDATION_ERROR');
  const location = asText(req.body?.customerAddress || req.body?.location || req.body?.address, '고객주소', 500);
  const inspectionCompany = asText(req.body?.inspectionCompany || '유지텔레컴', '점검작업업체', 200);
  const mediaType = asText(req.body?.mediaType || 'CABLE', '매체구분', 50);
  const title = '업무이관 사진 참조';
  const description = '상세내용은 완료 전 증빙사진에서 확인';
  const transferDate = inspectionRequestedDate;
  const cellName = optionalText(req.body?.cellName || req.body?.cellId, 100);
  const cell = cellName ? db.prepare(`
    SELECT id, cell_name FROM cells WHERE (id = ? OR cell_name = ?) AND deleted_at IS NULL
  `).get(cellName, cellName) as { id: string; cell_name: string } | undefined : undefined;
  if (cellName && !cell) throw new ApiError(404, '관련 CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  const photos = Array.isArray(req.body?.requestPhotos) ? req.body.requestPhotos as Array<Record<string, unknown>> : [];
  if (photos.length > maxEvidencePhotos) {
    throw new ApiError(400, `업무이관 사진은 최대 ${maxEvidencePhotos}장까지 등록할 수 있습니다.`, 'PHOTO_LIMIT_EXCEEDED');
  }
  const requestedOcrStatus = req.body?.ocrStatus === 'succeeded'
    ? 'succeeded' : req.body?.ocrStatus === 'failed' ? 'failed' : 'pending';
  const storedPhotos: Array<PendingPhoto & { objectKey: string; mimeType: string; size: number }> = [];
  let createdId = '';
  try {
    for (const [index, photo] of photos.entries()) {
      const dataUrl = asText(photo.dataUrl, '사진 데이터', 15 * 1024 * 1024);
      const fileName = optionalText(photo.fileName, 160) || `업무이관 사진 ${index + 1}`;
      const stored = await savePrivatePhoto(dataUrl, user.id);
      storedPhotos.push({ fileName, dataUrl, ...stored });
    }

    const id = randomUUID();
    createdId = id;
    const isUrgent = req.body?.isUrgent === true || req.body?.priority === 'urgent';
    const ocrEngine = optionalText(req.body?.ocrEngine, 80) || (requestedOcrStatus === 'pending' ? 'manual' : 'browser-tesseract-kor-eng');
    const extra = {
      serviceNo: optionalText(req.body?.serviceNo, 100) || `TR-${Date.now()}`,
      contractor: inspectionCompany,
      inspectionCompany,
      requestDate: transferDate,
      status: '미완료',
      mediaType,
      cellName: cell?.cell_name || '', location, customerAddress: location,
      branchName,
      registeredByName: user.name, regionId, regionName: region.region_name, isUrgent,
      inspectionDate: inspectionRequestedDate,
      inspectionRequestedDate,
      ocrEngine,
    };

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO work_transfers (
          id, cell_id, title, description, from_user_id, priority, status, transfer_date,
          extra_json, region_id, workflow_status, is_urgent, ocr_status, ocr_text,
          branch_name, requester_name, inspection_company, inspection_requested_date,
          customer_address, handover_reason, media_type, tap_rn_location, pole_number,
          lead_in_length, pre_action_notes, inspection_request_details, evidence_photo_count
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'registered', ?, ?, ?,
          ?, '', ?, ?, ?, '', ?, '', '', '', '', '', ?)
      `).run(id, cell?.id || null, title, description, user.id, isUrgent ? 'urgent' : 'normal', transferDate,
        JSON.stringify(extra), regionId, isUrgent ? 1 : 0, requestedOcrStatus, '',
        branchName, inspectionCompany, inspectionRequestedDate, location, mediaType, storedPhotos.length);
      for (const photo of storedPhotos) {
        const attachmentId = randomUUID();
        db.prepare(`
          INSERT INTO work_transfer_attachments (
            id, transfer_id, attachment_type, file_name, file_url, file_type, file_size, uploaded_by
          ) VALUES (?, ?, 'request_photo', ?, ?, ?, ?, ?)
        `).run(attachmentId, id, photo.fileName, photo.objectKey, photo.mimeType, photo.size, user.id);
      }
      if (requestedOcrStatus !== 'pending') {
        db.prepare(`
          INSERT INTO work_transfer_ocr_runs (
            id, transfer_id, attachment_id, engine, status, extracted_text, error_message, requested_by, completed_at
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), id, ocrEngine, requestedOcrStatus, '', null, user.id, new Date().toISOString());
      }
      db.prepare(`
        INSERT INTO work_transfer_logs (transfer_id, author_user_id, author_name, to_status, comment, created_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `).run(id, user.id, user.name, isUrgent ? '긴급 업무이관 등록' : '업무이관 등록', transferDate);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const created = db.prepare(`${transferSelect} AND wt.id = ?`).get(id) as Record<string, unknown>;
    writeAuditLog(req, { action: 'WORK_TRANSFER_CREATED', targetType: 'work_transfer', targetId: id, metadata: { regionId, isUrgent } });
    success(res, mapTransferRow(created), 201);
  } catch (error) {
    if (!createdId || !db.prepare('SELECT 1 FROM work_transfers WHERE id = ?').get(createdId)) {
      await Promise.all(storedPhotos.map((photo) => removePrivatePhoto(photo.objectKey).catch(() => undefined)));
    }
    throw error;
  }
}));

router.put('/:id', (req, res) => {
  const user = authUser(req);
  if (!registrationRoles.has(user.role)) throw new ApiError(403, '업무이관을 수정할 권한이 없습니다.', 'FORBIDDEN');
  const existing = accessibleTransfer(req.params.id, user);
  if (String(existing.workflow_status) === 'completed') throw new ApiError(409, '완료된 업무이관은 수정할 수 없습니다.', 'TRANSFER_COMPLETED');
  if (req.body?.status || req.body?.workflowStatus) {
    throw new ApiError(400, '상태는 현장처리·완료 전용 기능으로 변경해 주세요.', 'INVALID_STATUS_TRANSITION');
  }
  const nextRegionId = req.body?.regionId === undefined ? String(existing.region_id) : asText(req.body.regionId, '지역', 100);
  assertRegionPermission(user, nextRegionId);
  regionById(nextRegionId);
  const saved = JSON.parse(String(existing.extra_json || '{}')) as Record<string, unknown>;
  const branchName = req.body?.branchName === undefined
    ? String(existing.branch_name || saved.branchName || '') : asText(req.body.branchName, '지점', 100);
  const locationInput = req.body?.customerAddress ?? req.body?.location;
  const location = locationInput === undefined
    ? String(existing.customer_address || saved.customerAddress || saved.location || '')
    : asText(locationInput, '고객주소', 500);
  const inspectionRequestedDate = req.body?.inspectionRequestedDate === undefined
    ? String(existing.inspection_requested_date || existing.transfer_date).slice(0, 10)
    : normalizeDay(req.body.inspectionRequestedDate, '점검요청일');
  if (!inspectionRequestedDate) throw new ApiError(400, '점검요청일을 입력해 주세요.', 'VALIDATION_ERROR');
  const inspectionCompany = req.body?.inspectionCompany === undefined
    ? String(existing.inspection_company || saved.inspectionCompany || '유지텔레컴')
    : asText(req.body.inspectionCompany, '점검작업업체', 200);
  const mediaType = req.body?.mediaType === undefined
    ? String(existing.media_type || saved.mediaType || 'CABLE')
    : asText(req.body.mediaType, '매체구분', 50);
  const isUrgent = req.body?.isUrgent === undefined ? Boolean(existing.is_urgent) : req.body.isUrgent === true;
  const nextExtra: Record<string, unknown> = {
    ...saved, branchName, location, customerAddress: location,
    inspectionDate: inspectionRequestedDate, inspectionRequestedDate,
    contractor: inspectionCompany, inspectionCompany, mediaType,
    regionId: nextRegionId, isUrgent,
  };
  delete nextExtra.ocrText;
  delete nextExtra.ocrQuality;
  db.prepare(`
    UPDATE work_transfers SET region_id = ?, priority = ?, is_urgent = ?, ocr_text = '',
      extra_json = ?, transfer_date = ?, branch_name = ?, inspection_company = ?,
      inspection_requested_date = ?, customer_address = ?, media_type = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(nextRegionId, isUrgent ? 'urgent' : 'normal', isUrgent ? 1 : 0,
    JSON.stringify(nextExtra), inspectionRequestedDate, branchName, inspectionCompany,
    inspectionRequestedDate, location, mediaType, req.params.id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO work_transfer_logs (transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, user.id, user.name, String(existing.status), String(existing.status), '업무이관 등록정보 수정', now);
  writeAuditLog(req, { action: 'WORK_TRANSFER_UPDATED', targetType: 'work_transfer', targetId: req.params.id, metadata: { regionId: nextRegionId } });
  success(res, mapTransferRow(accessibleTransfer(req.params.id, user)));
});

router.delete('/:id', requireRoles('admin', 'public_official'), asyncRoute(async (req, res) => {
  const user = authUser(req);
  const existing = accessibleTransfer(req.params.id, user);
  const reason = asText(req.body?.reason, '삭제 사유', 1000);
  const now = new Date().toISOString();
  const attachments = storedAttachments(req.params.id);
  await removeStoredAttachmentFiles(attachments);
  db.exec('BEGIN IMMEDIATE');
  try {
    const deletedAttachments = db.prepare('DELETE FROM work_transfer_attachments WHERE transfer_id = ?').run(req.params.id);
    if (Number(deletedAttachments.changes) !== attachments.length) {
      throw new Error('업무이관 첨부사진 DB 삭제 건수가 일치하지 않습니다.');
    }
    db.prepare(`
      INSERT INTO work_transfer_logs (
        transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, user.id, user.name, String(existing.status), String(existing.status),
      `업무이관 삭제: ${reason}`, now,
    );
    db.prepare(`
      UPDATE work_transfers
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?,
             evidence_photo_count = MAX(evidence_photo_count, ?),
             evidence_photos_deleted_at = ?, ocr_text = '', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL
    `).run(now, user.id, reason, attachments.length, now, req.params.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAuditLog(req, {
    action: 'WORK_TRANSFER_DELETED', targetType: 'work_transfer', targetId: req.params.id,
    metadata: {
      reason,
      workflowStatus: existing.workflow_status,
      branchName: existing.branch_name,
      customerAddress: existing.customer_address,
      inspectionRequestedDate: existing.inspection_requested_date,
      purgedPhotoCount: attachments.length,
    },
  });
  success(res, { id: req.params.id, deleted: true });
}));

router.post('/:id/attachments', asyncRoute(async (req, res) => {
  const user = authUser(req);
  const transfer = accessibleTransfer(req.params.id, user);
  const attachmentType = asText(req.body?.attachmentType, '사진 유형', 30);
  if (!allowedAttachmentTypes.has(attachmentType)) throw new ApiError(400, '허용되지 않은 사진 유형입니다.', 'VALIDATION_ERROR');
  if (attachmentType === 'request_photo' && !registrationRoles.has(user.role)) throw new ApiError(403, '접수 사진을 추가할 권한이 없습니다.', 'FORBIDDEN');
  if (String(transfer.workflow_status) === 'completed') throw new ApiError(409, '완료된 건에는 사진을 추가할 수 없습니다.', 'TRANSFER_COMPLETED');
  const fileName = asText(req.body?.fileName, '파일명', 160);
  const dataUrl = asText(req.body?.dataUrl, '사진 데이터', 15 * 1024 * 1024);
  const stored = await savePrivatePhoto(dataUrl, user.id);
  const id = randomUUID();
  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    const attachmentCount = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM work_transfer_attachments WHERE transfer_id = ?
    `).get(req.params.id) as { count: number }).count);
    if (attachmentCount >= maxEvidencePhotos) {
      throw new ApiError(400, `업무이관 사진은 최대 ${maxEvidencePhotos}장까지 등록할 수 있습니다.`, 'PHOTO_LIMIT_EXCEEDED');
    }
    db.prepare(`
      INSERT INTO work_transfer_attachments (
        id, transfer_id, attachment_type, file_name, file_url, file_type, file_size, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, attachmentType, fileName, stored.objectKey, stored.mimeType, stored.size, user.id);
    db.prepare(`
      UPDATE work_transfers
         SET evidence_photo_count = evidence_photo_count + 1,
             evidence_photos_deleted_at = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(req.params.id);
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec('ROLLBACK');
    await removePrivatePhoto(stored.objectKey).catch(() => undefined);
    throw error;
  }
  writeAuditLog(req, { action: 'WORK_TRANSFER_PHOTO_UPLOADED', targetType: 'work_transfer_attachment', targetId: id, metadata: { transferId: req.params.id, attachmentType } });
  success(res, { id, attachmentType, fileName, url: `/work-transfers/${req.params.id}/attachments/${id}/file` }, 201);
}));

const attachmentForUser = (transferId: string, attachmentId: string, user: AuthUser) => {
  accessibleTransfer(transferId, user);
  const attachment = db.prepare(`
    SELECT * FROM work_transfer_attachments WHERE id = ? AND transfer_id = ? AND deleted_at IS NULL
  `).get(attachmentId, transferId) as Record<string, unknown> | undefined;
  if (!attachment) throw new ApiError(404, '사진을 찾을 수 없습니다.', 'NOT_FOUND');
  return attachment;
};

router.get('/:id/attachments/:attachmentId/file', asyncRoute(async (req, res) => {
  const attachment = attachmentForUser(req.params.id, req.params.attachmentId, authUser(req));
  const objectKey = String(attachment.file_url);
  if (usesR2Storage) {
    res.redirect(302, await privatePhotoDownloadUrl(objectKey));
    return;
  }
  const absolutePath = resolvePrivatePhoto(objectKey);
  if (!fs.existsSync(absolutePath)) throw new ApiError(404, '사진 파일을 찾을 수 없습니다.', 'NOT_FOUND');
  res.setHeader('Content-Type', privatePhotoMime(objectKey));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(absolutePath);
}));

router.get('/:id/attachments/:attachmentId/access-url', asyncRoute(async (req, res) => {
  const attachment = attachmentForUser(req.params.id, req.params.attachmentId, authUser(req));
  const objectKey = String(attachment.file_url);
  const url = usesR2Storage
    ? await privatePhotoDownloadUrl(objectKey)
    : `/work-transfers/${req.params.id}/attachments/${req.params.attachmentId}/file`;
  success(res, { url });
}));

router.post('/:id/ocr', (req, _res) => {
  const user = authUser(req);
  if (!registrationRoles.has(user.role)) throw new ApiError(403, 'OCR을 실행할 권한이 없습니다.', 'FORBIDDEN');
  accessibleTransfer(req.params.id, user);
  throw new ApiError(410, 'OCR은 사진을 서버로 보내지 않고 브라우저에서만 실행됩니다.', 'BROWSER_OCR_ONLY');
});

router.post('/:id/field-actions', (req, res) => {
  const user = authUser(req);
  const existing = accessibleTransfer(req.params.id, user);
  const currentStatus = String(existing.workflow_status);
  if (currentStatus === 'completed') throw new ApiError(409, '완료된 업무이관은 현장처리할 수 없습니다.', 'TRANSFER_COMPLETED');
  if (user.role === 'manager' && currentStatus === 'field_processed' && String(existing.field_processed_by || '') !== user.id) {
    throw new ApiError(403, '다른 작업자의 현장처리 내용을 수정할 수 없습니다.', 'FORBIDDEN');
  }
  const actionText = asText(req.body?.actionText || req.body?.fieldActionText, '현장 처리내용', 3000);
  const processedAt = normalizeDate(req.body?.processedAt, '처리일시') || new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO work_transfer_field_actions (id, transfer_id, action_text, processed_by, processed_by_name, processed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, actionText, user.id, user.name, processedAt);
    db.prepare(`
      UPDATE work_transfers SET workflow_status = 'field_processed', status = 'transferred',
        field_processed_at = COALESCE(field_processed_at, ?), field_processed_by = COALESCE(field_processed_by, ?),
        to_user_id = COALESCE(to_user_id, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(processedAt, user.id, user.id, req.params.id);
    db.prepare(`
      INSERT INTO work_transfer_logs (transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at)
      VALUES (?, ?, ?, ?, 'transferred', ?, ?)
    `).run(req.params.id, user.id, user.name, String(existing.status), actionText, processedAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAuditLog(req, { action: 'WORK_TRANSFER_FIELD_PROCESSED', targetType: 'work_transfer', targetId: req.params.id, metadata: { fieldActionId: id } });
  success(res, mapTransferRow(accessibleTransfer(req.params.id, user)), 201);
});

router.post('/:id/complete', asyncRoute(async (req, res) => {
  const user = authUser(req);
  if (!completionRoles.has(user.role)) throw new ApiError(403, '최종 완료 권한이 없습니다.', 'FORBIDDEN');
  const existing = accessibleTransfer(req.params.id, user);
  if (String(existing.workflow_status) !== 'field_processed') throw new ApiError(409, '현장처리된 업무만 완료할 수 있습니다.', 'FIELD_ACTION_REQUIRED');
  const actionCount = Number((db.prepare('SELECT COUNT(*) AS count FROM work_transfer_field_actions WHERE transfer_id = ?').get(req.params.id) as { count: number }).count);
  if (actionCount < 1) throw new ApiError(409, '현장처리 이력이 있어야 완료할 수 있습니다.', 'FIELD_ACTION_REQUIRED');
  const comment = optionalText(req.body?.comment, 1000) || '최종 업무이관 완료';
  const now = new Date().toISOString();
  const attachments = storedAttachments(req.params.id);

  // 파일 저장소는 DB 트랜잭션과 원자적으로 묶을 수 없으므로 먼저 모두 지운다.
  // 중간 실패 시 완료 상태는 바뀌지 않으며, 재시도하면 존재하지 않는 로컬 파일은
  // 안전하게 건너뛰고 남은 파일부터 계속 삭제한다.
  await removeStoredAttachmentFiles(attachments);
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleted = db.prepare('DELETE FROM work_transfer_attachments WHERE transfer_id = ?').run(req.params.id);
    if (Number(deleted.changes) !== attachments.length) {
      throw new Error('업무이관 첨부사진 DB 삭제 건수가 일치하지 않습니다.');
    }
    db.prepare(`
      UPDATE work_transfers SET workflow_status = 'completed', status = 'completed', completed_at = ?,
        final_completed_by = ?, evidence_photo_count = MAX(evidence_photo_count, ?),
        evidence_photos_deleted_at = ?, ocr_text = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(now, user.id, attachments.length, now, req.params.id);
    db.prepare(`
      INSERT INTO work_transfer_logs (transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at)
      VALUES (?, ?, ?, ?, 'completed', ?, ?)
    `).run(req.params.id, user.id, user.name, String(existing.status), comment, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAuditLog(req, {
    action: 'WORK_TRANSFER_COMPLETED', targetType: 'work_transfer', targetId: req.params.id,
    metadata: { purgedPhotoCount: attachments.length },
  });
  success(res, mapTransferRow(accessibleTransfer(req.params.id, user)));
}));

router.post('/:id/reopen', requireRoles('admin', 'public_official'), (req, res) => {
  const user = authUser(req);
  const existing = accessibleTransfer(req.params.id, user);
  if (String(existing.workflow_status) !== 'completed') throw new ApiError(409, '완료된 업무만 재오픈할 수 있습니다.', 'INVALID_STATUS_TRANSITION');
  const reason = asText(req.body?.reason, '재오픈 사유', 1000);
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE work_transfers SET workflow_status = 'field_processed', status = 'transferred', completed_at = NULL,
        final_completed_by = NULL, reopened_at = ?, reopened_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(now, user.id, req.params.id);
    db.prepare(`
      INSERT INTO work_transfer_logs (transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at)
      VALUES (?, ?, ?, 'completed', 'transferred', ?, ?)
    `).run(req.params.id, user.id, user.name, `재오픈: ${reason}`, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAuditLog(req, { action: 'WORK_TRANSFER_REOPENED', targetType: 'work_transfer', targetId: req.params.id, metadata: { reason } });
  success(res, mapTransferRow(accessibleTransfer(req.params.id, user)));
});

export default router;
