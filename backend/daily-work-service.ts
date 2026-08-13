import { randomUUID } from 'node:crypto';
import { db } from './db';
import { ApiError } from './http';

export type WorkCategoryRow = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export type AggregateDimension = 'person' | 'region' | 'month' | 'period';

export type DailyWorkFilters = {
  from?: string;
  to?: string;
  year?: string;
  month?: string;
  userId?: string;
  regionId?: string;
  categoryId?: string;
  sortBy?: string;
  sortOrder?: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeWorkDate = (value: unknown) => {
  const normalized = String(value || '').trim().replace(/\./g, '-');
  if (!datePattern.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new ApiError(400, '업무일자는 YYYY-MM-DD 형식이어야 합니다.', 'VALIDATION_ERROR');
  }
  return normalized;
};

export const todayInSeoul = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export const getWorkCategories = (includeInactive = false): WorkCategoryRow[] => {
  const rows = db.prepare(`
    SELECT id, code, category_name, sort_order, active
      FROM work_categories
     ${includeInactive ? '' : 'WHERE active = 1'}
     ORDER BY sort_order, code
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.category_name),
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
  }));
};

export const normalizeWorkCounts = (input: unknown, categories = getWorkCategories()) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, '작업 건수 정보가 필요합니다.', 'VALIDATION_ERROR');
  }
  const raw = input as Record<string, unknown>;
  return categories.map((category) => {
    const supplied = raw[category.code] ?? raw[category.name] ?? 0;
    const count = supplied === '' || supplied === null || supplied === undefined ? 0 : Number(supplied);
    if (!Number.isInteger(count) || count < 0 || count > 9999) {
      throw new ApiError(400, `${category.name} 건수는 0 이상의 정수여야 합니다.`, 'VALIDATION_ERROR');
    }
    return { ...category, count };
  });
};

const dailyRecordSql = `
  SELECT d.id, d.work_date, d.user_id, d.region_id, d.memo, d.created_at, d.updated_at,
         d.created_by, d.updated_by, u.name AS worker_name, u.department,
         COALESCE(r.region_name, u.department) AS region_name
    FROM daily_work d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN regions r ON r.id = d.region_id
`;

export const getDailyWorkRecord = (id: string, includeDeleted = false) => {
  const row = db.prepare(`${dailyRecordSql} WHERE d.id = ? ${includeDeleted ? '' : 'AND d.deleted_at IS NULL'}`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, '일일업무를 찾을 수 없습니다.', 'NOT_FOUND');
  const categories = getWorkCategories(true);
  const itemRows = db.prepare(`
    SELECT c.code, i.work_count
      FROM daily_work_items i
      JOIN work_categories c ON c.id = i.category_id
     WHERE i.daily_work_id = ?
  `).all(id) as Array<{ code: string; work_count: number }>;
  const stored = new Map(itemRows.map((item) => [item.code, Number(item.work_count)]));
  const counts = Object.fromEntries(categories.map((category) => [category.code, stored.get(category.code) || 0]));
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
  return {
    id: String(row.id),
    date: String(row.work_date),
    workDate: String(row.work_date),
    userId: String(row.user_id),
    workerName: String(row.worker_name),
    team: String(row.department),
    regionId: row.region_id ? String(row.region_id) : '',
    regionName: String(row.region_name || row.department || ''),
    counts,
    total,
    memo: row.memo ? String(row.memo) : '',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    createdBy: row.created_by ? String(row.created_by) : String(row.user_id),
    updatedBy: row.updated_by ? String(row.updated_by) : String(row.user_id),
  };
};

export const saveHistory = (
  dailyWorkId: string,
  changedBy: string,
  changeType: 'CREATE' | 'UPDATE' | 'DELETE',
  beforeData: unknown,
  afterData: unknown
) => {
  db.prepare(`
    INSERT INTO daily_work_history (
      id, daily_work_id, changed_by, change_type, before_data, after_data, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    dailyWorkId,
    changedBy,
    changeType,
    beforeData === null ? null : JSON.stringify(beforeData),
    afterData === null ? null : JSON.stringify(afterData),
    new Date().toISOString()
  );
};

const resolveRange = (filters: DailyWorkFilters) => {
  if (filters.year && filters.month) {
    const month = String(filters.month).padStart(2, '0');
    const from = normalizeWorkDate(`${filters.year}-${month}-01`);
    const end = new Date(Date.UTC(Number(filters.year), Number(month), 0));
    return { from, to: `${filters.year}-${month}-${String(end.getUTCDate()).padStart(2, '0')}` };
  }
  return {
    from: filters.from ? normalizeWorkDate(filters.from) : undefined,
    to: filters.to ? normalizeWorkDate(filters.to) : undefined,
  };
};

const buildWhere = (filters: DailyWorkFilters) => {
  const { from, to } = resolveRange(filters);
  const clauses = ['d.deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (from) { clauses.push('d.work_date >= ?'); params.push(from); }
  if (to) { clauses.push('d.work_date <= ?'); params.push(to); }
  if (filters.userId) { clauses.push('d.user_id = ?'); params.push(filters.userId); }
  if (filters.regionId) { clauses.push('d.region_id = ?'); params.push(filters.regionId); }
  if (filters.categoryId) {
    clauses.push('(c.code = ? OR c.id = ?)');
    params.push(filters.categoryId, filters.categoryId);
  }
  return { sql: clauses.join(' AND '), params, from, to };
};

export const aggregateDailyWork = (dimension: AggregateDimension, filters: DailyWorkFilters) => {
  const { sql, params, from, to } = buildWhere(filters);
  const allCategories = getWorkCategories();
  const categories = filters.categoryId
    ? allCategories.filter((category) => category.code === filters.categoryId || category.id === filters.categoryId)
    : allCategories;
  if (filters.categoryId && categories.length === 0) {
    throw new ApiError(400, '업무구분을 찾을 수 없습니다.', 'VALIDATION_ERROR');
  }

  const grouping = dimension === 'person'
    ? {
        select: `d.id AS row_key, d.id, d.work_date, d.user_id, u.name AS worker_name,
                 d.region_id, COALESCE(r.region_name, u.department) AS region_name, d.memo,
                 d.created_at, d.updated_at`,
        group: 'd.id, d.work_date, d.user_id, u.name, d.region_id, r.region_name, u.department, d.memo, d.created_at, d.updated_at',
      }
    : dimension === 'region'
      ? {
          select: `d.work_date || ':' || COALESCE(d.region_id, '') AS row_key, NULL AS id,
                   d.work_date, NULL AS user_id, NULL AS worker_name, d.region_id,
                   COALESCE(r.region_name, u.department) AS region_name, NULL AS memo,
                   NULL AS created_at, MAX(d.updated_at) AS updated_at`,
          group: 'd.work_date, d.region_id, r.region_name, u.department',
        }
      : {
          select: `d.work_date AS row_key, NULL AS id, d.work_date, NULL AS user_id,
                   NULL AS worker_name, NULL AS region_id, NULL AS region_name, NULL AS memo,
                   NULL AS created_at, MAX(d.updated_at) AS updated_at`,
          group: 'd.work_date',
        };

  const rows = db.prepare(`
    SELECT ${grouping.select}, c.code AS category_code, SUM(i.work_count) AS work_count
      FROM daily_work d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN regions r ON r.id = d.region_id
      JOIN daily_work_items i ON i.daily_work_id = d.id
      JOIN work_categories c ON c.id = i.category_id AND c.active = 1
     WHERE ${sql}
     GROUP BY ${grouping.group}, c.code
  `).all(...params) as Array<Record<string, unknown>>;

  const resultByKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = String(row.row_key);
    const current = resultByKey.get(key) || {
      key,
      id: row.id ? String(row.id) : undefined,
      date: String(row.work_date),
      workDate: String(row.work_date),
      userId: row.user_id ? String(row.user_id) : undefined,
      workerName: row.worker_name ? String(row.worker_name) : undefined,
      regionId: row.region_id ? String(row.region_id) : undefined,
      regionName: row.region_name ? String(row.region_name) : undefined,
      memo: row.memo ? String(row.memo) : '',
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      counts: Object.fromEntries(categories.map((category) => [category.code, 0])),
      total: 0,
    };
    const counts = current.counts as Record<string, number>;
    counts[String(row.category_code)] = Number(row.work_count || 0);
    current.total = Number(current.total || 0) + Number(row.work_count || 0);
    resultByKey.set(key, current);
  }

  const totalsRows = db.prepare(`
    SELECT c.code, SUM(i.work_count) AS work_count
      FROM daily_work d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN regions r ON r.id = d.region_id
      JOIN daily_work_items i ON i.daily_work_id = d.id
      JOIN work_categories c ON c.id = i.category_id AND c.active = 1
     WHERE ${sql}
     GROUP BY c.code
  `).all(...params) as Array<{ code: string; work_count: number }>;
  const categoryTotals = Object.fromEntries(categories.map((category) => [category.code, 0])) as Record<string, number>;
  totalsRows.forEach((row) => { categoryTotals[row.code] = Number(row.work_count || 0); });
  const grandTotal = Object.values(categoryTotals).reduce((sum, count) => sum + count, 0);

  const resultRows = [...resultByKey.values()];
  const direction = String(filters.sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  const sortBy = filters.sortBy || 'work_date';
  resultRows.sort((left, right) => {
    const value = (row: Record<string, unknown>) => sortBy === 'total'
      ? Number(row.total || 0)
      : sortBy === 'name'
        ? String(row.workerName || '')
        : sortBy === 'region'
          ? String(row.regionName || '')
          : String(row.workDate || '');
    const a = value(left);
    const b = value(right);
    return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ko')) * direction;
  });

  return { categories, rows: resultRows, categoryTotals, grandTotal, from, to };
};

export const getDailyWorkMeta = (includeUsers = false) => ({
  today: todayInSeoul(),
  categories: getWorkCategories(),
  regions: (db.prepare(`
    SELECT id, region_name AS name, sort_order AS sortOrder
      FROM regions WHERE active = 1 ORDER BY sort_order, region_name
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), name: String(row.name), sortOrder: Number(row.sortOrder),
  })),
  users: includeUsers
    ? (db.prepare(`
        SELECT id, name, department, region_id AS regionId,
               COALESCE(access_role, CASE role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) AS role
          FROM users WHERE status = 'active' AND deleted_at IS NULL
         ORDER BY name
      `).all() as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), name: String(row.name), department: String(row.department),
        regionId: row.regionId ? String(row.regionId) : '', role: String(row.role),
      }))
    : [],
});
