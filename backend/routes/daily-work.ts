import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import * as XLSX from '@e965/xlsx';
import { db } from '../db';
import {
  aggregateDailyWork,
  getDailyWorkMeta,
  getDailyWorkRecord,
  getWorkCategories,
  normalizeWorkCounts,
  normalizeWorkDate,
  saveHistory,
  todayInSeoul,
} from '../daily-work-service';
import { ApiError, optionalText, success } from '../http';
import { writeAuditLog } from '../security/audit';
import { authUser, type AuthUser, requireAuth, requireRoles } from '../security/session';

const router = Router();
router.use(requireAuth);

const globalDailyWorkRoles = new Set(['admin', 'public_official']);
const delegatedDailyWorkRoles = new Set(['admin', 'public_official', 'team_leader']);

type DailyWorkTarget = {
  id: string;
  name: string;
  department: string;
  region_id: string | null;
};

const requireRegion = (user: AuthUser) => {
  if (user.regionId) return user.regionId;
  throw new ApiError(403, '계정에 담당 지역이 지정되지 않았습니다. 관리자에게 문의해 주세요.', 'REGION_REQUIRED');
};

const activeTarget = (targetUserId: string) => {
  const target = db.prepare(`
    SELECT id, name, department, region_id
      FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL
       AND COALESCE(access_role, CASE role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) <> 'guest'
  `).get(targetUserId) as DailyWorkTarget | undefined;
  if (!target) throw new ApiError(404, '작업자를 찾을 수 없습니다.', 'NOT_FOUND');
  return target;
};

const assertCanAccess = (user: AuthUser, ownerId: string, regionId: string | undefined) => {
  if (globalDailyWorkRoles.has(user.role)) return;
  if (user.role === 'team_leader' && regionId && regionId === requireRegion(user)) return;
  if ((user.role === 'manager' || user.role === 'guest') && ownerId === user.id) return;
  throw new ApiError(404, '일일업무를 찾을 수 없습니다.', 'NOT_FOUND');
};

const assertCanEdit = (user: AuthUser, target: DailyWorkTarget, workDate: string) => {
  if (user.role === 'guest') {
    throw new ApiError(403, '게스트 계정은 일일업무를 변경할 수 없습니다.', 'GUEST_READ_ONLY');
  }
  const today = todayInSeoul();
  if (workDate > today) {
    throw new ApiError(400, '미래 날짜의 일일업무는 등록할 수 없습니다.', 'FUTURE_WORK_DATE');
  }
  if (globalDailyWorkRoles.has(user.role)) return;
  if (user.role === 'team_leader') {
    if (!target.region_id || target.region_id !== requireRegion(user)) {
      throw new ApiError(404, '작업자를 찾을 수 없습니다.', 'NOT_FOUND');
    }
    return;
  }
  if (target.id !== user.id) {
    throw new ApiError(403, '본인의 일일업무만 수정할 수 있습니다.', 'FORBIDDEN');
  }
  if (workDate !== today) {
    throw new ApiError(403, '매니져는 오늘 일일업무만 수정할 수 있습니다.', 'PAST_WORK_LOCKED');
  }
};

const writeItems = (dailyWorkId: string, counts: ReturnType<typeof normalizeWorkCounts>) => {
  const statement = db.prepare(`
    INSERT INTO daily_work_items (id, daily_work_id, category_id, work_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(daily_work_id, category_id)
    DO UPDATE SET work_count = excluded.work_count, updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  counts.forEach((item) => statement.run(randomUUID(), dailyWorkId, item.id, item.count, now));
};

router.get('/meta', (req, res) => {
  const user = authUser(req);
  const includeUsers = delegatedDailyWorkRoles.has(user.role);
  const regionId = user.role === 'team_leader' ? requireRegion(user) : undefined;
  success(res, getDailyWorkMeta(includeUsers, regionId));
});

router.get('/my', (req, res) => {
  const user = authUser(req);
  success(res, aggregateDailyWork('person', {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    userId: user.id,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
    sortOrder: typeof req.query.sortOrder === 'string' ? req.query.sortOrder : undefined,
  }));
});

router.get('/export', requireRoles('admin', 'team_leader', 'public_official'), (req, res) => {
  const user = authUser(req);
  const result = aggregateDailyWork('person', {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    userId: user.id,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : 'work_date',
    sortOrder: typeof req.query.sortOrder === 'string' ? req.query.sortOrder : 'asc',
  });
  const header = ['날짜', ...result.categories.map((category) => category.name), '합계', '비고'];
  const rows = result.rows.map((row) => [
    row.workDate,
    ...result.categories.map((category) => (row.counts as Record<string, number>)[category.code] || 0),
    row.total,
    row.memo || '',
  ]);
  const totals = ['합계', ...result.categories.map((category) => result.categoryTotals[category.code] || 0), result.grandTotal, ''];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...rows, totals]), '내 업무내역');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.categories.map((category) => ({
    업무구분코드: category.code,
    업무구분: category.name,
    합계: result.categoryTotals[category.code] || 0,
  }))), '업무구분별 합계');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const filename = `전송망_일일업무_${user.name}_${result.from || '전체'}_${result.to || '전체'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
});

router.get('/record', (req, res) => {
  const user = authUser(req);
  const workDate = normalizeWorkDate(req.query.date);
  const targetUserId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : user.id;
  const target = activeTarget(targetUserId);
  assertCanAccess(user, target.id, target.region_id || undefined);
  const row = db.prepare(`
    SELECT id FROM daily_work
     WHERE work_date = ? AND user_id = ? AND title = '일일업무 집계' AND deleted_at IS NULL
  `).get(workDate, target.id) as { id: string } | undefined;
  if (!row) {
    success(res, null);
    return;
  }
  const record = getDailyWorkRecord(row.id);
  let canEdit = true;
  try { assertCanEdit(user, target, workDate); } catch { canEdit = false; }
  success(res, { ...record, canEdit });
});

router.get('/:id/history', (req, res) => {
  const user = authUser(req);
  const record = getDailyWorkRecord(req.params.id, true);
  assertCanAccess(user, record.userId, record.regionId);
  const rows = db.prepare(`
    SELECT h.id, h.change_type, h.before_data, h.after_data, h.changed_at,
           u.id AS changed_by, u.name AS changed_by_name
      FROM daily_work_history h
      JOIN users u ON u.id = h.changed_by
     WHERE h.daily_work_id = ?
     ORDER BY h.changed_at DESC
  `).all(req.params.id) as Array<Record<string, unknown>>;
  success(res, rows.map((row) => ({
    id: String(row.id),
    changeType: String(row.change_type),
    beforeData: row.before_data ? JSON.parse(String(row.before_data)) : null,
    afterData: row.after_data ? JSON.parse(String(row.after_data)) : null,
    changedAt: String(row.changed_at),
    changedBy: String(row.changed_by),
    changedByName: String(row.changed_by_name),
  })));
});

router.get('/:id', (req, res) => {
  const user = authUser(req);
  const record = getDailyWorkRecord(req.params.id);
  assertCanAccess(user, record.userId, record.regionId);
  const target = activeTarget(record.userId);
  let canEdit = true;
  try { assertCanEdit(user, target, record.workDate); } catch { canEdit = false; }
  success(res, { ...record, canEdit });
});

router.get('/', (req, res) => {
  const user = authUser(req);
  const result = aggregateDailyWork('person', {
    from: typeof req.query.date === 'string' ? req.query.date : undefined,
    to: typeof req.query.date === 'string' ? req.query.date : undefined,
    userId: user.role === 'manager' || user.role === 'guest' ? user.id : undefined,
    regionId: user.role === 'team_leader' ? requireRegion(user) : undefined,
    sortOrder: 'desc',
  });
  success(res, result.rows);
});

router.post('/', (req, res) => {
  const user = authUser(req);
  const workDate = normalizeWorkDate(req.body?.date || req.body?.workDate);
  const requestedTargetId = req.body?.userId ? String(req.body.userId) : user.id;
  const targetUserId = delegatedDailyWorkRoles.has(user.role) ? requestedTargetId : user.id;
  if (!delegatedDailyWorkRoles.has(user.role) && requestedTargetId !== user.id) {
    throw new ApiError(403, '다른 사용자의 일일업무를 등록할 수 없습니다.', 'FORBIDDEN');
  }
  const target = activeTarget(targetUserId);
  assertCanEdit(user, target, workDate);
  if (!target.region_id) {
    const knownRegion = db.prepare('SELECT id FROM regions WHERE region_name = ?').get(target.department) as { id: string } | undefined;
    const resolvedRegionId = knownRegion?.id || randomUUID();
    if (!knownRegion) {
      const nextOrder = Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM regions').get() as { value: number }).value) + 1;
      db.prepare('INSERT INTO regions (id, region_name, sort_order) VALUES (?, ?, ?)').run(resolvedRegionId, target.department, nextOrder);
    }
    db.prepare('UPDATE users SET region_id = ? WHERE id = ?').run(resolvedRegionId, target.id);
    target.region_id = resolvedRegionId;
  }

  const categories = getWorkCategories();
  const counts = normalizeWorkCounts(req.body?.counts, categories);
  const memo = optionalText(req.body?.memo, 3000);
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const legacyCounts = Object.fromEntries(counts.map((item) => [item.name, item.count]));
  const existing = db.prepare(`
    SELECT id, deleted_at FROM daily_work
     WHERE work_date = ? AND user_id = ? AND title = '일일업무 집계'
  `).get(workDate, targetUserId) as { id: string; deleted_at: string | null } | undefined;
  const id = existing?.id || randomUUID();
  const before = existing && !existing.deleted_at ? getDailyWorkRecord(id) : null;
  if (before && !req.body?.updatedAt) {
    throw new ApiError(409, '이미 등록된 일일업무입니다. 기존 업무를 불러와 수정해 주세요.', 'DAILY_WORK_EXISTS');
  }
  if (before && req.body?.updatedAt && String(req.body.updatedAt) !== before.updatedAt) {
    throw new ApiError(409, '다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.', 'STALE_UPDATE');
  }
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (existing) {
      db.prepare(`
        UPDATE daily_work
           SET description = ?, result = ?, memo = ?, counts_json = ?, region_id = ?,
               updated_by = ?, updated_at = ?, deleted_at = NULL
         WHERE id = ?
      `).run(`${target.name} ${target.department} 작업 집계`, `총 ${total}건`, memo, JSON.stringify(legacyCounts), target.region_id, user.id, now, id);
    } else {
      db.prepare(`
        INSERT INTO daily_work (
          id, work_date, user_id, region_id, work_type, title, description, result,
          status, memo, counts_json, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '일일집계', '일일업무 집계', ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
      `).run(id, workDate, targetUserId, target.region_id, `${target.name} ${target.department} 작업 집계`, `총 ${total}건`, memo, JSON.stringify(legacyCounts), user.id, user.id, now, now);
    }
    writeItems(id, counts);
    const after = getDailyWorkRecord(id);
    saveHistory(id, user.id, before ? 'UPDATE' : 'CREATE', before, after);
    db.exec('COMMIT');
    success(res, { ...after, canEdit: true }, before ? 200 : 201);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

router.put('/:id', (req, res) => {
  const user = authUser(req);
  const before = getDailyWorkRecord(req.params.id);
  const workDate = normalizeWorkDate(req.body?.date || req.body?.workDate || before.workDate);
  const target = activeTarget(before.userId);
  assertCanEdit(user, target, workDate);
  if (req.body?.updatedAt && String(req.body.updatedAt) !== before.updatedAt) {
    throw new ApiError(409, '다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.', 'STALE_UPDATE');
  }
  const duplicate = db.prepare(`
    SELECT id FROM daily_work
     WHERE work_date = ? AND user_id = ? AND title = '일일업무 집계'
       AND deleted_at IS NULL AND id <> ?
  `).get(workDate, before.userId, req.params.id) as { id: string } | undefined;
  if (duplicate) throw new ApiError(409, '해당 날짜에 이미 등록된 일일업무가 있습니다.', 'DAILY_WORK_EXISTS');
  const categories = getWorkCategories();
  const counts = normalizeWorkCounts(req.body?.counts || before.counts, categories);
  const memo = req.body?.memo === undefined ? before.memo : optionalText(req.body.memo, 3000);
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const legacyCounts = Object.fromEntries(counts.map((item) => [item.name, item.count]));
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE daily_work
         SET work_date = ?, result = ?, memo = ?, counts_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ?
    `).run(workDate, `총 ${total}건`, memo, JSON.stringify(legacyCounts), user.id, now, req.params.id);
    writeItems(req.params.id, counts);
    const after = getDailyWorkRecord(req.params.id);
    saveHistory(req.params.id, user.id, 'UPDATE', before, after);
    db.exec('COMMIT');
    success(res, { ...after, canEdit: true });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

router.delete('/:id', (req, res) => {
  const user = authUser(req);
  if (!globalDailyWorkRoles.has(user.role)) {
    throw new ApiError(403, '관리자와 공무만 일일업무를 삭제할 수 있습니다.', 'FORBIDDEN');
  }
  const before = getDailyWorkRecord(req.params.id);
  const reason = optionalText(req.body?.reason, 500) || '사유 미입력';
  db.exec('BEGIN IMMEDIATE');
  try {
    writeAuditLog(req, {
      action: 'DAILY_WORK_DELETE',
      targetType: 'daily_work',
      targetId: req.params.id,
      metadata: {
        reason,
        workerId: before.userId,
        workerName: before.workerName,
        workDate: before.workDate,
        total: before.total,
      },
    });
    db.prepare('DELETE FROM daily_work_history WHERE daily_work_id = ?').run(req.params.id);
    const deleted = db.prepare('DELETE FROM daily_work WHERE id = ?').run(req.params.id);
    if (Number(deleted.changes) !== 1) throw new Error('일일업무 삭제 건수가 일치하지 않습니다.');
    db.exec('COMMIT');
    success(res, { id: req.params.id, deleted: true, hardDeleted: true });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

export default router;
