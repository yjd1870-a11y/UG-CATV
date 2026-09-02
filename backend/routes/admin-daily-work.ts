import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import * as XLSX from '@e965/xlsx';
import { db } from '../db';
import {
  AggregateDimension,
  aggregateDailyWork,
  DailyWorkFilters,
  getDailyWorkMeta,
  getDailyWorkRecord,
  getWorkCategories,
  todayInSeoul,
} from '../daily-work-service';
import { ApiError, asText, success } from '../http';
import { authUser, type AuthUser, requireAuth, requireRoles } from '../security/session';

const router = Router();
router.use(requireAuth, requireRoles('admin', 'public_official', 'team_leader'));

const requireRegion = (user: AuthUser) => {
  if (user.regionId) return user.regionId;
  throw new ApiError(403, '계정에 담당 지역이 지정되지 않았습니다. 관리자에게 문의해 주세요.', 'REGION_REQUIRED');
};

const filtersFromQuery = (query: Record<string, unknown>): DailyWorkFilters => ({
  from: typeof query.from === 'string' ? query.from : undefined,
  to: typeof query.to === 'string' ? query.to : undefined,
  year: typeof query.year === 'string' ? query.year : undefined,
  month: typeof query.month === 'string' ? query.month : undefined,
  userId: typeof query.userId === 'string' ? query.userId : undefined,
  regionId: typeof query.regionId === 'string' ? query.regionId : undefined,
  categoryId: typeof query.categoryId === 'string' ? query.categoryId : undefined,
  sortBy: typeof query.sortBy === 'string' ? query.sortBy : undefined,
  sortOrder: typeof query.sortOrder === 'string' ? query.sortOrder : undefined,
});

const scopedFilters = (user: AuthUser, query: Record<string, unknown>): DailyWorkFilters => ({
  ...filtersFromQuery(query),
  ...(user.role === 'team_leader' ? { regionId: requireRegion(user) } : {}),
});

const aggregateHandler = (dimension: AggregateDimension) => (req: Request, res: Response) => {
  success(res, aggregateDailyWork(dimension, scopedFilters(authUser(req), req.query as Record<string, unknown>)));
};

router.get('/meta', (req, res) => {
  const user = authUser(req);
  success(res, getDailyWorkMeta(true, user.role === 'team_leader' ? requireRegion(user) : undefined));
});

router.get('/summary', (req, res) => {
  const user = authUser(req);
  const today = todayInSeoul();
  const monthStart = `${today.slice(0, 7)}-01`;
  const regionId = user.role === 'team_leader' ? requireRegion(user) : undefined;
  const totalFor = (from: string, to: string) => Number((db.prepare(`
    SELECT COALESCE(SUM(i.work_count), 0) AS total
      FROM daily_work d
      JOIN users u ON u.id = d.user_id
      JOIN daily_work_items i ON i.daily_work_id = d.id
     WHERE d.deleted_at IS NULL AND d.work_date BETWEEN ? AND ?
       AND COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) <> 'guest'
       ${regionId ? 'AND d.region_id = ?' : ''}
  `).get(...(regionId ? [from, to, regionId] : [from, to])) as { total: number }).total);
  const entered = Number((db.prepare(`
    SELECT COUNT(DISTINCT d.user_id) AS count
      FROM daily_work d JOIN users u ON u.id = d.user_id
     WHERE d.deleted_at IS NULL AND d.work_date = ?
       AND COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) = 'manager'
       ${regionId ? 'AND u.region_id = ?' : ''}
  `).get(...(regionId ? [today, regionId] : [today])) as { count: number }).count);
  const target = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM users u
     WHERE u.status = 'active' AND u.deleted_at IS NULL
       AND COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) = 'manager'
       ${regionId ? 'AND u.region_id = ?' : ''}
  `).get(...(regionId ? [regionId] : [])) as { count: number }).count);
  success(res, {
    today,
    todayTotal: totalFor(today, today),
    monthTotal: totalFor(monthStart, today),
    enteredUsers: entered,
    missingUsers: Math.max(0, target - entered),
  });
});

router.get('/person', aggregateHandler('person'));
router.get('/region', aggregateHandler('region'));
router.get('/month', aggregateHandler('month'));
router.get('/period', aggregateHandler('period'));

router.get('/detail/:id', (req, res) => {
  const user = authUser(req);
  const record = getDailyWorkRecord(req.params.id);
  if (user.role === 'team_leader' && record.regionId !== requireRegion(user)) {
    throw new ApiError(404, '일일업무를 찾을 수 없습니다.', 'NOT_FOUND');
  }
  success(res, { ...record, canEdit: true });
});

router.get('/drilldown', (req, res) => {
  success(res, aggregateDailyWork('person', scopedFilters(authUser(req), req.query as Record<string, unknown>)));
});

router.get('/history', (req, res) => {
  const user = authUser(req);
  const workId = typeof req.query.workId === 'string' ? req.query.workId : '';
  const regionId = user.role === 'team_leader' ? requireRegion(user) : '';
  const clauses = [workId ? 'h.daily_work_id = ?' : '', regionId ? 'd.region_id = ?' : ''].filter(Boolean);
  const params = [...(workId ? [workId] : []), ...(regionId ? [regionId] : [])];
  const rows = db.prepare(`
    SELECT h.id, h.daily_work_id, h.change_type, h.before_data, h.after_data,
           h.changed_at, u.name AS changed_by_name
      FROM daily_work_history h
      JOIN users u ON u.id = h.changed_by
      JOIN daily_work d ON d.id = h.daily_work_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY h.changed_at DESC LIMIT 500
  `).all(...params) as Array<Record<string, unknown>>;
  success(res, rows.map((row) => ({
    id: String(row.id), dailyWorkId: String(row.daily_work_id),
    changeType: String(row.change_type),
    beforeData: row.before_data ? JSON.parse(String(row.before_data)) : null,
    afterData: row.after_data ? JSON.parse(String(row.after_data)) : null,
    changedAt: String(row.changed_at), changedByName: String(row.changed_by_name),
  })));
});

router.get('/export', (req, res) => {
  const mode = String(req.query.mode || 'period');
  const dimension: AggregateDimension = mode === 'person' || mode === 'region' || mode === 'month' ? mode : 'period';
  const result = aggregateDailyWork(dimension, scopedFilters(authUser(req), req.query as Record<string, unknown>));
  const labelByCode = Object.fromEntries(result.categories.map((category) => [category.code, category.name]));
  const header = ['날짜'];
  if (dimension === 'person') header.push('담당자', '지역');
  if (dimension === 'region') header.push('지역');
  header.push(...result.categories.map((category) => category.name), '합계');
  const rows = result.rows.map((row) => {
    const values: Array<string | number> = [String(row.workDate || '')];
    if (dimension === 'person') values.push(String(row.workerName || ''), String(row.regionName || ''));
    if (dimension === 'region') values.push(String(row.regionName || ''));
    result.categories.forEach((category) => values.push(Number((row.counts as Record<string, number>)[category.code] || 0)));
    values.push(Number(row.total || 0));
    return values;
  });
  const totalRow: Array<string | number> = ['합계'];
  if (dimension === 'person') totalRow.push('', '');
  if (dimension === 'region') totalRow.push('');
  result.categories.forEach((category) => totalRow.push(result.categoryTotals[category.code] || 0));
  totalRow.push(result.grandTotal);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...rows, totalRow]), '조회결과');
  const detailRows = result.rows.map((row) => ({
    날짜: row.workDate,
    담당자: row.workerName || '',
    지역: row.regionName || '',
    ...Object.fromEntries(result.categories.map((category) => [labelByCode[category.code], (row.counts as Record<string, number>)[category.code] || 0])),
    합계: row.total,
    비고: row.memo || '',
    최종수정시간: row.updatedAt || '',
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), '상세내역');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.categories.map((category) => ({
    업무구분코드: category.code,
    업무구분: category.name,
    합계: result.categoryTotals[category.code] || 0,
  }))), '업무구분별 합계');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const filename = `전송망_일일업무_${dimension}_${result.from || '전체'}_${result.to || '전체'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
});

router.get('/categories', requireRoles('admin'), (_req, res) => success(res, getWorkCategories(true)));

router.post('/categories', requireRoles('admin'), (req, res) => {
  const name = asText(req.body?.name, '업무구분명', 80);
  const max = db.prepare(`SELECT COALESCE(MAX(CAST(substr(code, 5) AS INTEGER)), 0) AS value FROM work_categories WHERE code LIKE 'WORK%'`).get() as { value: number };
  const code = `WORK${String(max.value + 1).padStart(2, '0')}`;
  const sort = Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM work_categories').get() as { value: number }).value) + 1;
  const id = randomUUID();
  db.prepare(`INSERT INTO work_categories (id, code, category_name, sort_order) VALUES (?, ?, ?, ?)`).run(id, code, name, sort);
  success(res, { id, code, name, sortOrder: sort, active: true }, 201);
});

router.put('/categories/:id', requireRoles('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM work_categories WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, '업무구분을 찾을 수 없습니다.', 'NOT_FOUND');
  const name = req.body?.name === undefined ? String(existing.category_name) : asText(req.body.name, '업무구분명', 80);
  const sortOrder = req.body?.sortOrder === undefined ? Number(existing.sort_order) : Number(req.body.sortOrder);
  const active = req.body?.active === undefined ? Number(existing.active) : req.body.active ? 1 : 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new ApiError(400, '표시순서는 1 이상의 정수여야 합니다.', 'VALIDATION_ERROR');
  db.prepare(`
    UPDATE work_categories SET category_name = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?
  `).run(name, sortOrder, active, new Date().toISOString(), req.params.id);
  success(res, getWorkCategories(true).find((category) => category.id === req.params.id));
});

export default router;
