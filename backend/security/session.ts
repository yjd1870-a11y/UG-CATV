import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { db } from '../db';
import { env } from '../env';
import { ApiError } from '../http';
import { securityLog } from './audit';

export type DbRole = 'manager' | 'public_official' | 'team_leader' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  employeeNumber: string | null;
  department: string;
  phone: string | null;
  company: string;
  role: DbRole;
  regionId: string | null;
  regionName: string | null;
  status: 'pending' | 'active' | 'disabled';
}

type UserRow = {
  id: string;
  username: string;
  name: string;
  employee_number: string | null;
  department: string;
  phone: string | null;
  company: string;
  role: DbRole;
  region_id: string | null;
  region_name: string | null;
  status: AuthUser['status'];
};

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  sessionToken?: string;
}

const parseCookies = (header: string | undefined) => {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try { cookies[name] = decodeURIComponent(value); } catch { cookies[name] = ''; }
  }
  return cookies;
};

const hashToken = (token: string) => createHmac('sha256', env.sessionSecret).update(token).digest('hex');

const cookieAttributes = () => {
  const secure = env.isProduction || env.cookieSameSite === 'none' ? '; Secure' : '';
  const sameSite = env.cookieSameSite[0].toUpperCase() + env.cookieSameSite.slice(1);
  return `HttpOnly; Path=/; SameSite=${sameSite}; Priority=High${secure}`;
};

export const toAuthUser = (row: UserRow): AuthUser => ({
  id: row.id,
  username: row.username,
  name: row.name,
  employeeNumber: row.employee_number,
  department: row.department,
  phone: row.phone,
  company: row.company,
  role: row.role,
  regionId: row.region_id,
  regionName: row.region_name,
  status: row.status,
});

export const createSession = (res: Response, userId: string) => {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), userId, hashToken(token), expiresAt.toISOString());
  res.append(
    'Set-Cookie',
    `${env.cookieName}=${encodeURIComponent(token)}; ${cookieAttributes()}; Max-Age=${env.sessionTtlHours * 3600}`
  );
};

export const clearSession = (req: Request, res: Response) => {
  const token = parseCookies(req.headers.cookie)[env.cookieName];
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  res.append('Set-Cookie', `${env.cookieName}=; ${cookieAttributes()}; Max-Age=0`);
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  const authReq = req as AuthenticatedRequest;
  const token = parseCookies(req.headers.cookie)[env.cookieName];
  if (!token) {
    next(new ApiError(401, '로그인이 필요합니다.', 'AUTH_REQUIRED'));
    return;
  }

  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.employee_number, u.department, u.phone,
           u.company,
           COALESCE(u.access_role, CASE u.role WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'team_leader' ELSE 'manager' END) AS role,
           u.region_id, r.region_name,
           u.status
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN regions r ON r.id = u.region_id
     WHERE s.token_hash = ?
       AND datetime(s.expires_at) > CURRENT_TIMESTAMP
       AND u.deleted_at IS NULL
  `).get(tokenHash) as UserRow | undefined;

  if (!row || row.status !== 'active') {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
    next(new ApiError(401, '로그인 세션이 만료되었습니다.', 'SESSION_EXPIRED'));
    return;
  }

  authReq.authUser = toAuthUser(row);
  authReq.sessionToken = token;
  db.prepare(`
    UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP
     WHERE token_hash = ? AND datetime(last_seen_at) <= datetime('now', '-5 minutes')
  `).run(tokenHash);
  next();
};

export const requireRoles = (...roles: DbRole[]): RequestHandler => (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user || !roles.includes(user.role)) {
    securityLog(req, {
      action: 'SECURITY_FORBIDDEN_ACCESS',
      targetType: 'route',
      targetId: req.originalUrl,
      metadata: { requiredRoles: roles, method: req.method },
    });
    next(new ApiError(403, '이 작업을 수행할 권한이 없습니다.', 'FORBIDDEN'));
    return;
  }
  next();
};

export const authUser = (req: Request) => {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) throw new ApiError(401, '로그인이 필요합니다.', 'AUTH_REQUIRED');
  return user;
};
