import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../../db';
import { ApiError, asText, asyncRoute, success } from '../../http';
import { hashPassword, isValidPassword, PASSWORD_POLICY_MESSAGE } from '../../security/password';
import { authUser } from '../../security/session';

type DbRole = 'manager' | 'guest' | 'public_official' | 'team_leader' | 'admin';

const router = Router();
const allowedRoles = new Set<DbRole>(['manager', 'guest', 'public_official', 'team_leader', 'admin']);

const ensureRegion = (regionName: string) => {
  const existing = db.prepare('SELECT id FROM regions WHERE region_name = ? AND active = 1').get(regionName) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const nextOrder = Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM regions').get() as { value: number }).value);
  db.prepare('INSERT INTO regions (id, region_name, sort_order) VALUES (?, ?, ?)').run(id, regionName, nextOrder);
  return id;
};

const legacyRoleValue = (role: DbRole) => role === 'admin' ? 'admin' : role === 'team_leader' ? 'manager' : 'worker';

const passwordValue = (value: unknown) => {
  if (typeof value !== 'string' || !isValidPassword(value)) {
    throw new ApiError(400, PASSWORD_POLICY_MESSAGE, 'VALIDATION_ERROR');
  }
  return value;
};

const roleValue = (value: unknown): DbRole => {
  if (typeof value !== 'string' || !allowedRoles.has(value as DbRole)) {
    throw new ApiError(400, '허용되지 않은 권한입니다.', 'VALIDATION_ERROR');
  }
  return value as DbRole;
};

const usernameValue = (value: unknown) => {
  const username = asText(value, '아이디', 64);
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new ApiError(400, '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~64자여야 합니다.', 'VALIDATION_ERROR');
  }
  return username;
};

const publicUsers = (status?: string) => {
  const where = status ? 'AND status = ?' : '';
  return db.prepare(`
    SELECT u.id, u.username, u.zone, u.name, u.employee_number AS employeeNumber, u.department,
           phone, company,
           COALESCE(access_role, CASE role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) AS role,
           u.region_id AS regionId, r.region_name AS regionName,
           u.status, u.created_at AS createdAt, u.updated_at AS updatedAt,
           u.last_login_at AS lastLoginAt, u.password_updated_at AS passwordUpdatedAt,
           CASE WHEN length(password_hash) > 0 THEN 1 ELSE 0 END AS passwordConfigured
      FROM users u
      LEFT JOIN regions r ON r.id = u.region_id
     WHERE u.deleted_at IS NULL ${where}
     ORDER BY u.created_at DESC
  `).all(...(status ? [status] : []));
};

router.get('/', (req, res) => {
  const requestedStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowed = ['pending', 'active', 'disabled'];
  if (requestedStatus && !allowed.includes(requestedStatus)) {
    throw new ApiError(400, '허용되지 않은 사용자 상태입니다.', 'VALIDATION_ERROR');
  }
  success(res, publicUsers(requestedStatus));
});

router.post('/', asyncRoute(async (req, res) => {
  const username = usernameValue(req.body?.username);
  const zone = asText(req.body?.zone, '지역', 100);
  const name = asText(req.body?.name, '이름', 100);
  const role = roleValue(req.body?.role);
  const password = passwordValue(req.body?.password);
  const regionId = ensureRegion(zone);
  const existing = db.prepare('SELECT id, deleted_at AS deletedAt FROM users WHERE lower(username) = lower(?)').get(username) as { id: string; deletedAt: string | null } | undefined;
  if (existing && !existing.deletedAt) throw new ApiError(409, '이미 사용 중인 아이디입니다.', 'DUPLICATE_USERNAME');
  const employeeOwner = db.prepare('SELECT id, deleted_at AS deletedAt FROM users WHERE employee_number = ? AND id <> ?').get(username, existing?.id || '') as { id: string; deletedAt: string | null } | undefined;
  if (employeeOwner && !employeeOwner.deletedAt) throw new ApiError(409, '동일한 사번을 사용 중인 계정이 있습니다.', 'DUPLICATE_EMPLOYEE_NUMBER');
  if (employeeOwner?.deletedAt) db.prepare('UPDATE users SET employee_number = NULL WHERE id = ?').run(employeeOwner.id);

  const id = existing?.id || randomUUID();
  const passwordHash = await hashPassword(password);
  if (existing) {
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
    db.prepare(`
      UPDATE users SET
        username = ?, password_hash = ?, name = ?, zone = ?, employee_number = ?, department = ?,
        phone = NULL, company = '유지텔레컴', role = ?, access_role = ?, region_id = ?, status = 'active',
        last_login_at = NULL, password_updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(username, passwordHash, name, zone, username, zone, legacyRoleValue(role), role, regionId, id);
  } else {
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, name, zone, employee_number, department,
        company, role, access_role, region_id, status, password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '유지텔레컴', ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    `).run(id, username, passwordHash, name, zone, username, zone, legacyRoleValue(role), role, regionId);
  }
  success(res, { id, username, zone, name, role, status: 'active' }, 201);
}));

router.put('/:id/approve', asyncRoute(async (req, res) => {
  const pending = db.prepare('SELECT department FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as { department: string } | undefined;
  if (!pending) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  const regionId = ensureRegion(pending.department);
  const result = db.prepare(`
    UPDATE users SET status = 'active', region_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(regionId, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, { id: req.params.id, status: 'active' });
}));

router.put('/:id/disable', asyncRoute(async (req, res) => {
  if (authUser(req).id === req.params.id) throw new ApiError(400, '현재 로그인한 관리자 계정은 중지할 수 없습니다.', 'SELF_ACTION');
  const result = db.prepare(`
    UPDATE users SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, status: 'disabled' });
}));

router.put('/:id/enable', asyncRoute(async (req, res) => {
  const result = db.prepare(`
    UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  success(res, { id: req.params.id, status: 'active' });
}));

router.put('/:id/role', (req, res) => {
  const role = roleValue(req.body?.role);
  if (authUser(req).id === req.params.id && role !== 'admin') {
    throw new ApiError(400, '현재 로그인한 관리자 권한은 변경할 수 없습니다.', 'SELF_ACTION');
  }
  const result = db.prepare(`
    UPDATE users
       SET role = ?, access_role = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(legacyRoleValue(role), role, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND user_id <> ?').run(req.params.id, authUser(req).id);
  success(res, { id: req.params.id, role });
});

router.put('/:id/password', asyncRoute(async (req, res) => {
  const passwordHash = await hashPassword(passwordValue(req.body?.password));
  const result = db.prepare(`
    UPDATE users
       SET password_hash = ?, password_updated_at = CURRENT_TIMESTAMP,
           status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(passwordHash, req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, passwordConfigured: true });
}));

router.delete('/:id', (req, res) => {
  if (authUser(req).id === req.params.id) throw new ApiError(400, '현재 로그인한 관리자 계정은 삭제할 수 없습니다.', 'SELF_ACTION');
  const result = db.prepare(`
    UPDATE users SET deleted_at = CURRENT_TIMESTAMP, status = 'disabled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) throw new ApiError(404, '사용자를 찾을 수 없습니다.', 'NOT_FOUND');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.params.id);
  success(res, { id: req.params.id, deleted: true });
});

export default router;
