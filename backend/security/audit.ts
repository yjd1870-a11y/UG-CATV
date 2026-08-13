import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db';
import type { AuthenticatedRequest } from './session';

type AuditInput = {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  role?: string;
};

const secretKey = /(password|secret|token|authorization|cookie|api.?key|credential)/i;

const safeMetadata = (value: unknown, depth = 0): unknown => {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => safeMetadata(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !secretKey.test(key))
        .slice(0, 30)
        .map(([key, entry]) => [key, safeMetadata(entry, depth + 1)])
    );
  }
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return String(value ?? '').slice(0, 500);
};

export const requestIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

export const writeAuditLog = (req: Request, input: AuditInput) => {
  const user = (req as AuthenticatedRequest).authUser;
  const metadata = JSON.stringify(safeMetadata(input.metadata || {})).slice(0, 8_000);
  try {
    db.prepare(`
      INSERT INTO audit_logs (
        id, user_id, role, action, target_type, target_id, ip_address, user_agent, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.userId ?? user?.id ?? null,
      input.role ?? user?.role ?? null,
      input.action.slice(0, 100),
      input.targetType?.slice(0, 100) || null,
      input.targetId?.slice(0, 200) || null,
      requestIp(req).slice(0, 100),
      (req.get('user-agent') || '').slice(0, 500),
      metadata
    );
  } catch (error) {
    console.error('[AUDIT_LOG_FAILED]', { action: input.action, error });
  }
};

export const securityLog = (req: Request, input: AuditInput) => {
  writeAuditLog(req, input);
  console.warn(`[${input.action}]`, {
    userId: input.userId ?? (req as AuthenticatedRequest).authUser?.id ?? null,
    targetType: input.targetType,
    targetId: input.targetId,
    ip: requestIp(req),
  });
};
