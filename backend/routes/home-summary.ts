import { Router } from 'express';
import { db } from '../db';
import { todayInSeoul } from '../daily-work-service';
import { ApiError, success } from '../http';
import { authUser, type AuthUser, requireAuth } from '../security/session';

const router = Router();
router.use(requireAuth);

const globalRoles = new Set(['admin', 'public_official']);
const effectiveRoleSql = `COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END)`;

const previousSeoulDate = (today: string) => {
  const [year, month, day] = today.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

const requireRegion = (user: AuthUser) => {
  if (user.regionId) return user.regionId;
  throw new ApiError(403, '계정에 담당 지역이 지정되지 않았습니다. 관리자에게 문의해 주세요.', 'REGION_REQUIRED');
};

const managerMissingCount = (date: string, user: AuthUser) => {
  const scoped = !globalRoles.has(user.role);
  const regionId = scoped ? requireRegion(user) : undefined;
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
      FROM users u
     WHERE u.status = 'active' AND u.deleted_at IS NULL
       AND ${effectiveRoleSql} = 'manager'
       ${scoped ? 'AND u.region_id = ?' : ''}
       AND NOT EXISTS (
         SELECT 1 FROM daily_work d
          WHERE d.user_id = u.id AND d.work_date = ?
            AND d.title = '일일업무 집계' AND d.deleted_at IS NULL
       )
  `).get(...(scoped ? [regionId, date] : [date])) as { count: number }).count);
};

router.get('/summary', (req, res) => {
  const user = authUser(req);
  const today = todayInSeoul();
  const previousDate = previousSeoulDate(today);
  const scoped = !globalRoles.has(user.role);
  const regionId = scoped ? requireRegion(user) : undefined;
  const incompleteTransferCount = Number((db.prepare(`
    SELECT COUNT(*) AS count
      FROM work_transfers wt
     WHERE wt.deleted_at IS NULL AND wt.workflow_status <> 'completed'
       ${scoped ? 'AND wt.region_id = ?' : ''}
  `).get(...(scoped ? [regionId] : [])) as { count: number }).count);

  success(res, {
    previousDate,
    today,
    previousMissingCount: managerMissingCount(previousDate, user),
    todayMissingCount: managerMissingCount(today, user),
    incompleteTransferCount,
  });
});

export default router;
