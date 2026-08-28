import { Router, type Request } from 'express';
import { db } from '../db';
import { ApiError, success } from '../http';
import { authUser, requireAuth, requireRoles, type AuthUser } from '../security/session';

const router = Router();
router.use(requireAuth, requireRoles('admin', 'public_official', 'team_leader'));

type SqlFilter = { sql: string; params: Array<string | number> };
type Period = {
  periodType: 'month' | 'range' | 'year';
  from: string;
  to: string;
  month?: string;
  year?: string;
  bucket: 'day' | 'month';
};

const requestDateSql = 'date(COALESCE(wt.inspection_requested_date, wt.transfer_date))';
const completedDateSql = "date(datetime(wt.completed_at, '+9 hours'))";
const analyticsRoles = new Set(['admin', 'public_official']);
const detailMetrics = new Set([
  'received', 'registered', 'fieldProcessed', 'completedFromReceived', 'completedInPeriod', 'urgent',
]);

const parseDay = (value: unknown, field: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, `${field} 형식이 올바르지 않습니다.`, 'VALIDATION_ERROR');
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ApiError(400, `${field} 형식이 올바르지 않습니다.`, 'VALIDATION_ERROR');
  }
  return text;
};

const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
};

const resolvePeriod = (req: Request): Period => {
  const periodType = req.query.periodType === 'year' || req.query.periodType === 'range' ? req.query.periodType : 'month';
  if (periodType === 'month') {
    const month = typeof req.query.month === 'string' ? req.query.month : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, '조회 월을 확인해 주세요.', 'VALIDATION_ERROR');
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { periodType, month, from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, bucket: 'day' };
  }
  if (periodType === 'year') {
    const year = typeof req.query.year === 'string' ? req.query.year : '';
    if (!/^\d{4}$/.test(year)) throw new ApiError(400, '조회 연도를 확인해 주세요.', 'VALIDATION_ERROR');
    return { periodType, year, from: `${year}-01-01`, to: `${year}-12-31`, bucket: 'month' };
  }
  const from = parseDay(req.query.from, '시작일');
  const to = parseDay(req.query.to, '종료일');
  const span = daysBetween(from, to);
  if (span < 1) throw new ApiError(400, '시작일은 종료일보다 늦을 수 없습니다.', 'VALIDATION_ERROR');
  if (span > 1_827) throw new ApiError(400, '기간별 조회는 최대 5년까지 가능합니다.', 'VALIDATION_ERROR');
  return { periodType, from, to, bucket: span <= 62 ? 'day' : 'month' };
};

const assertRegion = (user: AuthUser, regionId: string) => {
  if (!analyticsRoles.has(user.role) && user.regionId !== regionId) {
    throw new ApiError(404, '지역 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  }
  const found = db.prepare('SELECT 1 FROM regions WHERE id = ? AND active = 1').get(regionId);
  if (!found) throw new ApiError(400, '선택한 지역을 찾을 수 없습니다.', 'INVALID_REGION');
};

const analyticsFilter = (req: Request, user: AuthUser): SqlFilter => {
  const clauses = ['wt.deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (!analyticsRoles.has(user.role)) {
    if (!user.regionId) throw new ApiError(403, '계정에 담당 지역이 지정되지 않았습니다.', 'REGION_REQUIRED');
    clauses.push('wt.region_id = ?');
    params.push(user.regionId);
  }
  const requestedRegion = typeof req.query.regionId === 'string' ? req.query.regionId.trim() : '';
  if (requestedRegion) {
    assertRegion(user, requestedRegion);
    clauses.push('wt.region_id = ?');
    params.push(requestedRegion);
  }
  const fieldProcessorId = typeof req.query.fieldProcessorId === 'string' ? req.query.fieldProcessorId.trim() : '';
  if (fieldProcessorId === 'unassigned') {
    clauses.push('wt.field_processed_by IS NULL');
  } else if (fieldProcessorId) {
    const processor = db.prepare(`
      SELECT u.id, u.region_id
        FROM users u
       WHERE u.id = ? AND u.deleted_at IS NULL AND u.status = 'active'
         AND COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) = 'manager'
    `).get(fieldProcessorId) as { id: string; region_id: string | null } | undefined;
    if (!processor || (!analyticsRoles.has(user.role) && processor.region_id !== user.regionId)) {
      throw new ApiError(404, '현장처리자를 찾을 수 없습니다.', 'NOT_FOUND');
    }
    clauses.push('wt.field_processed_by = ?');
    params.push(fieldProcessorId);
  }
  if (req.query.urgent === 'true' || req.query.urgent === 'false') {
    clauses.push('wt.is_urgent = ?');
    params.push(req.query.urgent === 'true' ? 1 : 0);
  } else if (req.query.urgent && req.query.urgent !== 'all') {
    throw new ApiError(400, '긴급 여부 조건을 확인해 주세요.', 'VALIDATION_ERROR');
  }
  return { sql: clauses.join(' AND '), params };
};

const numberValue = (value: unknown) => Number(value || 0);
const percent = (part: number, total: number) => total ? Math.round((part / total) * 10_000) / 100 : 0;

const bucketKeys = (period: Period) => {
  const keys: string[] = [];
  if (period.bucket === 'month') {
    let year = Number(period.from.slice(0, 4));
    let month = Number(period.from.slice(5, 7));
    const endYear = Number(period.to.slice(0, 4));
    const endMonth = Number(period.to.slice(5, 7));
    while (year < endYear || (year === endYear && month <= endMonth)) {
      keys.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month === 13) { year += 1; month = 1; }
    }
    return keys;
  }
  const end = Date.parse(`${period.to}T00:00:00Z`);
  for (let time = Date.parse(`${period.from}T00:00:00Z`); time <= end; time += 86_400_000) {
    keys.push(new Date(time).toISOString().slice(0, 10));
  }
  return keys;
};

const detailPredicate = (metric: string, period: Period) => {
  const requestRange = `${requestDateSql} BETWEEN date(?) AND date(?)`;
  switch (metric) {
    case 'registered': return { sql: `${requestRange} AND wt.workflow_status = 'registered'`, params: [period.from, period.to] };
    case 'fieldProcessed': return { sql: `${requestRange} AND wt.workflow_status = 'field_processed'`, params: [period.from, period.to] };
    case 'completedFromReceived': return { sql: `${requestRange} AND wt.workflow_status = 'completed'`, params: [period.from, period.to] };
    case 'completedInPeriod': return { sql: `${completedDateSql} BETWEEN date(?) AND date(?)`, params: [period.from, period.to] };
    case 'urgent': return { sql: `${requestRange} AND wt.is_urgent = 1`, params: [period.from, period.to] };
    default: return { sql: requestRange, params: [period.from, period.to] };
  }
};

const detailRows = (filter: SqlFilter, period: Period, metric: string, limit: number, offset: number) => db.prepare(`
  SELECT wt.id,
         ${requestDateSql} AS received_date,
         COALESCE(r.region_name, '') AS region_name,
         wt.branch_name, wt.customer_address, wt.handover_reason, wt.is_urgent,
         COALESCE(field_user.name, '현장처리자 미지정') AS field_processor_name,
         wt.field_processed_at, wt.completed_at, wt.workflow_status,
         CASE WHEN wt.completed_at IS NOT NULL
           THEN ROUND((julianday(datetime(wt.completed_at, '+9 hours')) - julianday(${requestDateSql})) * 24, 1)
           ELSE NULL END AS processing_hours
    FROM work_transfers wt
    LEFT JOIN regions r ON r.id = wt.region_id
    LEFT JOIN users field_user ON field_user.id = wt.field_processed_by
   WHERE ${filter.sql} AND ${detailPredicate(metric, period).sql}
   ORDER BY wt.is_urgent DESC, ${requestDateSql} DESC, wt.created_at DESC
   LIMIT ? OFFSET ?
`).all(...filter.params, ...detailPredicate(metric, period).params, limit, offset) as Array<Record<string, unknown>>;

const queryAnalytics = (req: Request, user: AuthUser) => {
  const period = resolvePeriod(req);
  const filter = analyticsFilter(req, user);
  const rangeParams = [period.from, period.to];
  const summaryRow = db.prepare(`
    SELECT
      SUM(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) AND wt.workflow_status = 'registered' THEN 1 ELSE 0 END) AS registered,
      SUM(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) AND wt.workflow_status = 'field_processed' THEN 1 ELSE 0 END) AS field_processed,
      SUM(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) AND wt.workflow_status = 'completed' THEN 1 ELSE 0 END) AS completed_from_received,
      SUM(CASE WHEN ${completedDateSql} BETWEEN date(?) AND date(?) THEN 1 ELSE 0 END) AS completed_in_period,
      SUM(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) AND wt.is_urgent = 1 THEN 1 ELSE 0 END) AS urgent,
      AVG(CASE WHEN ${requestDateSql} BETWEEN date(?) AND date(?) AND wt.workflow_status = 'completed' AND wt.completed_at IS NOT NULL
        THEN (julianday(datetime(wt.completed_at, '+9 hours')) - julianday(${requestDateSql})) * 24 END) AS average_processing_hours
      FROM work_transfers wt
     WHERE ${filter.sql}
  `).get(...rangeParams, ...rangeParams, ...rangeParams, ...rangeParams, ...rangeParams, ...rangeParams, ...rangeParams, ...filter.params) as Record<string, unknown>;

  const received = numberValue(summaryRow.received);
  const completedFromReceived = numberValue(summaryRow.completed_from_received);
  const summary = {
    received,
    registered: numberValue(summaryRow.registered),
    fieldProcessed: numberValue(summaryRow.field_processed),
    completedFromReceived,
    completedInPeriod: numberValue(summaryRow.completed_in_period),
    completionRate: percent(completedFromReceived, received),
    urgent: numberValue(summaryRow.urgent),
    averageProcessingHours: summaryRow.average_processing_hours == null ? null : Math.round(Number(summaryRow.average_processing_hours) * 10) / 10,
  };

  const bucketExpr = period.bucket === 'day' ? requestDateSql : `strftime('%Y-%m', ${requestDateSql})`;
  const completedBucketExpr = period.bucket === 'day' ? completedDateSql : `strftime('%Y-%m', ${completedDateSql})`;
  const cohortTrend = db.prepare(`
    SELECT ${bucketExpr} AS bucket,
           COUNT(*) AS received,
           SUM(CASE WHEN wt.workflow_status = 'registered' THEN 1 ELSE 0 END) AS registered,
           SUM(CASE WHEN wt.workflow_status = 'field_processed' THEN 1 ELSE 0 END) AS field_processed,
           SUM(CASE WHEN wt.workflow_status = 'completed' THEN 1 ELSE 0 END) AS completed_from_received,
           SUM(CASE WHEN wt.is_urgent = 1 THEN 1 ELSE 0 END) AS urgent
      FROM work_transfers wt
     WHERE ${filter.sql} AND ${requestDateSql} BETWEEN date(?) AND date(?)
     GROUP BY bucket
  `).all(...filter.params, period.from, period.to) as Array<Record<string, unknown>>;
  const completionTrend = db.prepare(`
    SELECT ${completedBucketExpr} AS bucket, COUNT(*) AS completed_in_period
      FROM work_transfers wt
     WHERE ${filter.sql} AND ${completedDateSql} BETWEEN date(?) AND date(?)
     GROUP BY bucket
  `).all(...filter.params, period.from, period.to) as Array<Record<string, unknown>>;
  const cohortByBucket = new Map(cohortTrend.map((row) => [String(row.bucket), row]));
  const completionByBucket = new Map(completionTrend.map((row) => [String(row.bucket), row]));
  const trend = bucketKeys(period).map((bucket) => {
    const cohort = cohortByBucket.get(bucket) || {};
    const completion = completionByBucket.get(bucket) || {};
    const bucketReceived = numberValue(cohort.received);
    const bucketCompleted = numberValue(cohort.completed_from_received);
    return {
      bucket,
      received: bucketReceived,
      registered: numberValue(cohort.registered),
      fieldProcessed: numberValue(cohort.field_processed),
      completedFromReceived: bucketCompleted,
      completedInPeriod: numberValue(completion.completed_in_period),
      completionRate: percent(bucketCompleted, bucketReceived),
      urgent: numberValue(cohort.urgent),
    };
  });

  const byRegion = (db.prepare(`
    SELECT wt.region_id AS region_id, COALESCE(r.region_name, '지역 미지정') AS region_name,
           COUNT(*) AS received,
           SUM(CASE WHEN wt.workflow_status = 'registered' THEN 1 ELSE 0 END) AS registered,
           SUM(CASE WHEN wt.workflow_status = 'field_processed' THEN 1 ELSE 0 END) AS field_processed,
           SUM(CASE WHEN wt.workflow_status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN wt.is_urgent = 1 THEN 1 ELSE 0 END) AS urgent
      FROM work_transfers wt
      LEFT JOIN regions r ON r.id = wt.region_id
     WHERE ${filter.sql} AND ${requestDateSql} BETWEEN date(?) AND date(?)
     GROUP BY wt.region_id, r.region_name
     ORDER BY received DESC, region_name
  `).all(...filter.params, period.from, period.to) as Array<Record<string, unknown>>).map((row) => ({
    regionId: row.region_id || null,
    regionName: String(row.region_name),
    received: numberValue(row.received),
    registered: numberValue(row.registered),
    fieldProcessed: numberValue(row.field_processed),
    completed: numberValue(row.completed),
    completionRate: percent(numberValue(row.completed), numberValue(row.received)),
    urgent: numberValue(row.urgent),
  }));

  const byFieldProcessor = (db.prepare(`
    SELECT wt.field_processed_by AS processor_id,
           COALESCE(field_user.name, '현장처리자 미지정') AS processor_name,
           CASE WHEN wt.field_processed_by IS NULL
             THEN COALESCE(transfer_region.region_name, '지역 미지정')
             ELSE COALESCE(processor_region.region_name, '지역 미지정') END AS region_name,
           COUNT(*) AS received,
           SUM(CASE WHEN wt.field_processed_by IS NOT NULL THEN 1 ELSE 0 END) AS processed,
           SUM(CASE WHEN wt.workflow_status = 'field_processed' THEN 1 ELSE 0 END) AS field_processed,
           SUM(CASE WHEN wt.workflow_status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN wt.is_urgent = 1 THEN 1 ELSE 0 END) AS urgent,
           AVG(CASE WHEN wt.workflow_status = 'completed' AND wt.completed_at IS NOT NULL
             THEN (julianday(datetime(wt.completed_at, '+9 hours')) - julianday(${requestDateSql})) * 24 END) AS average_processing_hours
      FROM work_transfers wt
      LEFT JOIN users field_user ON field_user.id = wt.field_processed_by
      LEFT JOIN regions processor_region ON processor_region.id = field_user.region_id
      LEFT JOIN regions transfer_region ON transfer_region.id = wt.region_id
     WHERE ${filter.sql} AND ${requestDateSql} BETWEEN date(?) AND date(?)
     GROUP BY wt.field_processed_by, field_user.name,
       CASE WHEN wt.field_processed_by IS NULL THEN transfer_region.region_name ELSE processor_region.region_name END
     ORDER BY processed DESC, processor_name
  `).all(...filter.params, period.from, period.to) as Array<Record<string, unknown>>).map((row) => ({
    fieldProcessorId: row.processor_id || null,
    fieldProcessorName: String(row.processor_name),
    regionName: String(row.region_name),
    received: numberValue(row.received),
    processed: numberValue(row.processed),
    fieldProcessed: numberValue(row.field_processed),
    completed: numberValue(row.completed),
    completionRate: percent(numberValue(row.completed), numberValue(row.received)),
    urgent: numberValue(row.urgent),
    averageProcessingHours: row.average_processing_hours == null ? null : Math.round(Number(row.average_processing_hours) * 10) / 10,
  }));

  const metric = typeof req.query.detailMetric === 'string' && detailMetrics.has(req.query.detailMetric) ? req.query.detailMetric : 'received';
  const detailPage = Math.max(1, Number(req.query.detailPage) || 1);
  const detailLimit = Math.min(100, Math.max(1, Number(req.query.detailLimit) || 30));
  const predicate = detailPredicate(metric, period);
  const detailTotal = numberValue((db.prepare(`
    SELECT COUNT(*) AS count FROM work_transfers wt
     WHERE ${filter.sql} AND ${predicate.sql}
  `).get(...filter.params, ...predicate.params) as { count: number }).count);
  const details = detailRows(filter, period, metric, detailLimit, (detailPage - 1) * detailLimit).map((row) => ({
    id: String(row.id), receivedDate: String(row.received_date), regionName: String(row.region_name),
    branchName: String(row.branch_name || ''), customerAddress: String(row.customer_address || ''),
    handoverReason: String(row.handover_reason || ''), isUrgent: Boolean(row.is_urgent),
    fieldProcessorName: String(row.field_processor_name), fieldProcessedAt: row.field_processed_at || null,
    completedAt: row.completed_at || null, workflowStatus: String(row.workflow_status),
    processingHours: row.processing_hours == null ? null : Number(row.processing_hours),
  }));

  return {
    filters: { ...period, regionId: req.query.regionId || '', fieldProcessorId: req.query.fieldProcessorId || '', urgent: req.query.urgent || 'all' },
    summary, trend, byRegion, byFieldProcessor,
    details: { metric, page: detailPage, limit: detailLimit, total: detailTotal, items: details },
  };
};

router.get('/meta', (req, res) => {
  const user = authUser(req);
  const regions = analyticsRoles.has(user.role)
    ? db.prepare('SELECT id, region_name AS name FROM regions WHERE active = 1 ORDER BY sort_order, region_name').all()
    : db.prepare('SELECT id, region_name AS name FROM regions WHERE id = ? AND active = 1').all(user.regionId);
  const processorScope = analyticsRoles.has(user.role) ? '' : ' AND u.region_id = ?';
  const processors = db.prepare(`
    SELECT u.id, u.name, u.region_id AS regionId, COALESCE(r.region_name, '') AS regionName
      FROM users u
      LEFT JOIN regions r ON r.id = u.region_id
     WHERE u.deleted_at IS NULL AND u.status = 'active'
       AND COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) = 'manager'
       ${processorScope}
     ORDER BY r.sort_order, u.name
  `).all(...(analyticsRoles.has(user.role) ? [] : [user.regionId])) as Array<Record<string, unknown>>;
  success(res, {
    regions,
    fieldProcessors: [{ id: 'unassigned', name: '현장처리자 미지정', regionId: null, regionName: '' }, ...processors],
    currentRegionId: user.regionId,
    currentRegionName: user.regionName,
    regionLocked: user.role === 'team_leader',
  });
});

router.get('/export', (req, res) => {
  const user = authUser(req);
  const period = resolvePeriod(req);
  const filter = analyticsFilter(req, user);
  const metric = typeof req.query.detailMetric === 'string' && detailMetrics.has(req.query.detailMetric) ? req.query.detailMetric : 'received';
  const rows = detailRows(filter, period, metric, 10_000, 0);
  const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['점검요청일', '지역', '지점', '주소', '이관사유', '긴급', '현장처리자', '현장처리일시', '완료일시', '상태', '처리시간(시간)'];
  const statusLabels: Record<string, string> = { registered: '미완료', field_processed: '현장처리', completed: '완료' };
  const lines = rows.map((row) => [
    row.received_date, row.region_name, row.branch_name, row.customer_address, row.handover_reason,
    row.is_urgent ? '긴급' : '일반', row.field_processor_name, row.field_processed_at, row.completed_at,
    statusLabels[String(row.workflow_status)] || row.workflow_status, row.processing_hours,
  ].map(escapeCsv).join(','));
  const filename = `work-transfer-analytics-${period.from}-${period.to}.csv`;
  res.status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(`\uFEFF${header.map(escapeCsv).join(',')}\r\n${lines.join('\r\n')}`);
});

router.get('/', (req, res) => success(res, queryAnalytics(req, authUser(req))));

export default router;
