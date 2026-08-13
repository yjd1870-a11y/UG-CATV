import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db, toDbTransferStatus } from '../db';
import { ApiError, asText, optionalText, success } from '../http';
import { mapTransferRow } from '../mappers';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { writeAuditLog } from '../security/audit';

const router = Router();
router.use(requireAuth);

const transferSelect = `
  SELECT wt.*, c.cell_name
    FROM work_transfers wt
    LEFT JOIN cells c ON c.id = wt.cell_id
   WHERE wt.deleted_at IS NULL
`;

const allowedStatuses = ['대기', '작업중', '업무이관', '완료', 'pending', 'received', 'working', 'transferred', 'completed'];
const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const canManageAll = (role: string) => role === 'team_leader' || role === 'admin';

router.get('/', (req, res) => {
  const user = authUser(req);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const accessWhere = canManageAll(user.role) ? '' : ' AND (wt.from_user_id = ? OR wt.to_user_id = ? OR wt.to_user_id IS NULL)';
  const accessParams = canManageAll(user.role) ? [] : [user.id, user.id];
  const rows = status
    ? db.prepare(`${transferSelect}${accessWhere} AND wt.status = ? ORDER BY wt.transfer_date DESC LIMIT ?`).all(...accessParams, toDbTransferStatus(status), limit)
    : db.prepare(`${transferSelect}${accessWhere} ORDER BY wt.transfer_date DESC LIMIT ?`).all(...accessParams, limit);
  success(res, (rows as Array<Record<string, unknown>>).map(mapTransferRow));
});

router.post('/', requireRoles('team_leader', 'admin'), (req, res) => {
  const user = authUser(req);
  const id = randomUUID();
  const title = asText(req.body?.transferReason || req.body?.title, '이관 사유', 300);
  const description = asText(req.body?.requestDetails || req.body?.description || title, '점검 요청 내용', 3000);
  const cellName = asText(req.body?.cellName || req.body?.cellId, 'CELL', 100);
  const cell = db.prepare(`
    SELECT id, cell_name FROM cells WHERE (id = ? OR cell_name = ?) AND deleted_at IS NULL
  `).get(cellName, cellName) as { id: string; cell_name: string } | undefined;
  if (!cell) throw new ApiError(404, '관련 CELL 정보를 찾을 수 없습니다.', 'NOT_FOUND');

  const status = toDbTransferStatus(req.body?.status || '대기');
  if (!allowedStatuses.includes(req.body?.status || '대기')) {
    throw new ApiError(400, '허용되지 않은 업무이관 상태입니다.', 'VALIDATION_ERROR');
  }
  const priority = optionalText(req.body?.priority, 20) || 'normal';
  if (!allowedPriorities.has(priority)) throw new ApiError(400, '허용되지 않은 우선순위입니다.', 'VALIDATION_ERROR');
  const toUserId = optionalText(req.body?.toUserId, 100);
  if (toUserId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL").get(toUserId)) {
    throw new ApiError(400, '업무를 배정할 사용자를 찾을 수 없습니다.', 'INVALID_ASSIGNEE');
  }
  const transferDate = optionalText(req.body?.requestDate || req.body?.transferDate, 40) || new Date().toISOString();
  const extra = {
    ...req.body,
    id,
    cellName: cell.cell_name,
    transferReason: title,
    requestDetails: description,
    requesterName: user.name,
    requestDate: transferDate,
    status: req.body?.status || '대기',
    serviceNo: req.body?.serviceNo || `SVC-${Date.now()}`,
    contractor: req.body?.contractor || `${user.company} (${user.department})`,
    mediaType: req.body?.mediaType || 'HFC',
    serviceTech: req.body?.serviceTech || 'CATV/HFC',
    location: req.body?.location || cell.cell_name,
    preActionNotes: req.body?.preActionNotes || '',
    logs: [],
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO work_transfers (
        id, cell_id, title, description, from_user_id, to_user_id, priority, status,
        transfer_date, due_date, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cell.id,
      title,
      description,
      user.id,
      toUserId,
      priority,
      status,
      transferDate,
      req.body?.dueDate || null,
      JSON.stringify(extra)
    );
    db.prepare(`
      INSERT INTO work_transfer_logs (
        transfer_id, author_user_id, author_name, to_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, user.id, user.name, status, '현장 업무이관 신규 티켓 접수', transferDate);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const created = db.prepare(`${transferSelect} AND wt.id = ?`).get(id) as Record<string, unknown>;
  writeAuditLog(req, { action: 'WORK_TRANSFER_CREATED', targetType: 'work_transfer', targetId: id, metadata: { cellId: cell.id, toUserId } });
  success(res, mapTransferRow(created), 201);
});

router.put('/:id', (req, res) => {
  const user = authUser(req);
  const existing = db.prepare(`${transferSelect} AND wt.id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, '업무이관 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  if (!canManageAll(user.role)
    && String(existing.from_user_id || '') !== user.id
    && String(existing.to_user_id || '') !== user.id
    && existing.to_user_id !== null) {
    throw new ApiError(403, '이 업무이관을 변경할 권한이 없습니다.', 'FORBIDDEN');
  }

  const requestedStatus = req.body?.status || req.body?.toStatus;
  if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
    throw new ApiError(400, '허용되지 않은 업무이관 상태입니다.', 'VALIDATION_ERROR');
  }
  const nextStatus = requestedStatus ? toDbTransferStatus(requestedStatus) : String(existing.status);
  const saved = JSON.parse(String(existing.extra_json || '{}')) as Record<string, unknown>;
  const nextExtra = { ...saved, ...req.body, status: requestedStatus || saved.status };
  const now = new Date().toISOString();
  const priority = req.body?.priority === undefined ? String(existing.priority) : asText(req.body.priority, '우선순위', 20);
  if (!allowedPriorities.has(priority)) throw new ApiError(400, '허용되지 않은 우선순위입니다.', 'VALIDATION_ERROR');
  let toUserId = existing.to_user_id ? String(existing.to_user_id) : null;
  if (req.body?.toUserId !== undefined) {
    const requestedAssignee = optionalText(req.body.toUserId, 100);
    if (!canManageAll(user.role) && requestedAssignee !== user.id) {
      throw new ApiError(403, '다른 사용자에게 업무를 배정할 권한이 없습니다.', 'FORBIDDEN');
    }
    if (requestedAssignee && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL").get(requestedAssignee)) {
      throw new ApiError(400, '업무를 배정할 사용자를 찾을 수 없습니다.', 'INVALID_ASSIGNEE');
    }
    toUserId = requestedAssignee;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE work_transfers SET title = ?, description = ?, status = ?, to_user_id = ?,
        priority = ?, due_date = ?, completed_at = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(
      req.body?.transferReason || req.body?.title || String(existing.title),
      req.body?.requestDetails || req.body?.description || String(existing.description),
      nextStatus,
      toUserId,
      priority,
      req.body?.dueDate ?? (existing.due_date ? String(existing.due_date) : null),
      nextStatus === 'completed' ? now : existing.completed_at ? String(existing.completed_at) : null,
      JSON.stringify(nextExtra),
      req.params.id
    );
    if (requestedStatus && nextStatus !== existing.status) {
      db.prepare(`
        INSERT INTO work_transfer_logs (
          transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.params.id,
        user.id,
        user.name,
        String(existing.status),
        nextStatus,
        optionalText(req.body?.comment, 1000) || `상태를 ${requestedStatus}(으)로 변경`,
        now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const updated = db.prepare(`${transferSelect} AND wt.id = ?`).get(req.params.id) as Record<string, unknown>;
  writeAuditLog(req, { action: 'WORK_TRANSFER_UPDATED', targetType: 'work_transfer', targetId: req.params.id, metadata: { status: nextStatus, toUserId } });
  success(res, mapTransferRow(updated));
});

export default router;
