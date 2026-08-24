import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import { env } from '../env';
import { ApiError, asText, asyncRoute, optionalText, success } from '../http';
import { requestIp, securityLog, writeAuditLog } from '../security/audit';
import { noStore } from '../security/middleware';
import {
  hashPassword,
  isValidPassword,
  PASSWORD_POLICY_MESSAGE,
  passwordNeedsRehash,
  verifyPassword,
} from '../security/password';
import { authUser, clearSession, createSession, requireAuth, toAuthUser } from '../security/session';

const router = Router();
router.use(noStore);

type LoginRow = Parameters<typeof toAuthUser>[0] & { password_hash: string };

router.post('/signup', asyncRoute(async (req, res) => {
  const username = asText(req.body?.username, '아이디', 40);
  const password = asText(req.body?.password, '비밀번호', 128);
  const name = asText(req.body?.name, '이름', 50);
  const employeeNumber = optionalText(req.body?.employeeNumber, 30);
  const department = asText(req.body?.department, '부서', 80);
  const phone = optionalText(req.body?.phone, 30);

  if (!/^[A-Za-z0-9._-]{4,40}$/.test(username)) {
    throw new ApiError(400, '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 4~40자여야 합니다.', 'VALIDATION_ERROR');
  }
  if (!isValidPassword(password)) {
    throw new ApiError(400, PASSWORD_POLICY_MESSAGE, 'VALIDATION_ERROR');
  }
  if (phone && !/^[0-9+()\-\s]{8,30}$/.test(phone)) {
    throw new ApiError(400, '전화번호 형식이 올바르지 않습니다.', 'VALIDATION_ERROR');
  }

  const existing = db.prepare('SELECT id, deleted_at AS deletedAt FROM users WHERE lower(username) = lower(?)').get(username) as { id: string; deletedAt: string | null } | undefined;
  if (existing && !existing.deletedAt) throw new ApiError(409, '이미 사용 중인 아이디입니다.', 'DUPLICATE_USER');
  const employeeOwner = employeeNumber ? db.prepare(`
    SELECT id, deleted_at AS deletedAt FROM users WHERE employee_number = ? AND id <> ?
  `).get(employeeNumber, existing?.id || '') as { id: string; deletedAt: string | null } | undefined : undefined;
  if (employeeOwner && !employeeOwner.deletedAt) throw new ApiError(409, '이미 사용 중인 사번입니다.', 'DUPLICATE_USER');
  if (employeeOwner?.deletedAt) db.prepare('UPDATE users SET employee_number = NULL WHERE id = ?').run(employeeOwner.id);

  const passwordHash = await hashPassword(password);
  const id = existing?.id || randomUUID();
  if (existing) {
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
    db.prepare(`
      UPDATE users SET username = ?, password_hash = ?, name = ?, employee_number = ?, department = ?, phone = ?,
        role = 'worker', access_role = 'manager', status = 'pending', last_login_at = NULL,
        password_updated_at = CURRENT_TIMESTAMP, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(username, passwordHash, name, employeeNumber, department, phone, id);
  } else {
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, name, employee_number, department, phone, role, access_role, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'worker', 'manager', 'pending')
    `).run(id, username, passwordHash, name, employeeNumber, department, phone);
  }
  writeAuditLog(req, { action: 'ACCOUNT_SIGNUP_REQUESTED', targetType: 'user', targetId: id, metadata: { username } });
  success(res, { id, username, status: 'pending' }, 201);
}));

router.post('/login', asyncRoute(async (req, res) => {
  const username = asText(req.body?.username, '아이디', 40);
  const password = asText(req.body?.password, '비밀번호', 128);
  const normalizedUsername = username.toLowerCase();
  const ip = requestIp(req);
  db.prepare("DELETE FROM login_attempts WHERE datetime(created_at) < datetime('now', '-30 days')").run();
  db.prepare('DELETE FROM auth_sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP').run();
  const recentFailures = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM login_attempts
     WHERE username = ? AND ip_address = ? AND success = 0
       AND datetime(created_at) >= datetime('now', ?)
  `).get(normalizedUsername, ip, `-${env.loginWindowMinutes} minutes`) as { count: number }).count);
  if (recentFailures >= env.loginFailureLimit) {
    securityLog(req, {
      action: 'SECURITY_RATE_LIMITED',
      targetType: 'login',
      targetId: normalizedUsername,
      metadata: { reason: 'repeated_login_failures' },
    });
    throw new ApiError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 'LOGIN_LOCKED');
  }

  const row = db.prepare(`
    SELECT id, username, password_hash, name, employee_number, department, phone,
           company,
           COALESCE(access_role, CASE role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) AS role,
           status
      FROM users
     WHERE lower(username) = ? AND deleted_at IS NULL
  `).get(normalizedUsername) as LoginRow | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    db.prepare('INSERT INTO login_attempts (id, username, ip_address, success) VALUES (?, ?, ?, 0)')
      .run(randomUUID(), normalizedUsername, ip);
    securityLog(req, {
      action: 'SECURITY_LOGIN_FAILED',
      targetType: 'user',
      targetId: normalizedUsername,
      userId: row?.id,
    });
    throw new ApiError(401, '아이디 또는 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
  }
  if (row.status !== 'active') {
    securityLog(req, {
      action: 'SECURITY_LOGIN_BLOCKED',
      targetType: 'user',
      targetId: row.id,
      userId: row.id,
      metadata: { status: row.status },
    });
    const pending = row.status === 'pending';
    throw new ApiError(403, pending ? '관리자 승인 대기 중인 계정입니다.' : '사용 중지된 계정입니다. 관리자에게 문의하세요.', pending ? 'ACCOUNT_PENDING' : 'ACCOUNT_DISABLED');
  }

  if (passwordNeedsRehash(row.password_hash)) {
    db.prepare('UPDATE users SET password_hash = ?, password_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(await hashPassword(password), row.id);
  }
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ? OR datetime(expires_at) <= CURRENT_TIMESTAMP').run(row.id);
  db.prepare('DELETE FROM login_attempts WHERE username = ? AND ip_address = ?').run(normalizedUsername, ip);
  db.prepare('INSERT INTO login_attempts (id, username, ip_address, success) VALUES (?, ?, ?, 1)')
    .run(randomUUID(), normalizedUsername, ip);
  createSession(res, row.id);
  securityLog(req, {
    action: row.role === 'admin' ? 'SECURITY_ADMIN_LOGIN' : 'SECURITY_LOGIN_SUCCESS',
    targetType: 'user',
    targetId: row.id,
    userId: row.id,
    role: row.role,
  });
  success(res, toAuthUser(row));
}));

router.post('/logout', (req, res) => {
  clearSession(req, res);
  writeAuditLog(req, { action: 'SECURITY_LOGOUT' });
  success(res, { loggedOut: true });
});

router.get('/me', requireAuth, (req, res) => {
  success(res, authUser(req));
});

export default router;
