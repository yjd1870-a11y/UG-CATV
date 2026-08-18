import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../env';
import { ApiError } from '../http';
import { securityLog } from './audit';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

const normalizedOrigin = (value: string | undefined) => value?.trim().replace(/\/$/, '') || '';

export const isAllowedOrigin = (origin: string) => env.corsAllowedOrigins.has(normalizedOrigin(origin));

export const corsPolicy: RequestHandler = (req, res, next) => {
  const origin = normalizedOrigin(req.get('origin'));
  if (origin) {
    if (!isAllowedOrigin(origin)) {
      securityLog(req, { action: 'SECURITY_FORBIDDEN_ORIGIN', metadata: { origin, path: req.path } });
      next(new ApiError(403, '허용되지 않은 요청 출처입니다.', 'ORIGIN_FORBIDDEN'));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Amz-Meta-Sha256');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }
  const origin = normalizedOrigin(req.get('origin'));
  const hasSessionCookie = Boolean(req.get('cookie')?.includes(`${env.cookieName}=`));
  if (origin && !isAllowedOrigin(origin)) {
    next(new ApiError(403, '요청 출처를 확인할 수 없습니다.', 'CSRF_REJECTED'));
    return;
  }
  if (env.isProduction && hasSessionCookie && !origin) {
    securityLog(req, { action: 'SECURITY_CSRF_REJECTED', metadata: { path: req.path } });
    next(new ApiError(403, '요청 출처를 확인할 수 없습니다.', 'CSRF_REJECTED'));
    return;
  }
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  // Vite의 개발용 React Refresh는 index.html에 짧은 초기화 스크립트를 삽입합니다.
  // 로컬 개발에서만 이를 허용하고, 운영 환경에서는 기존의 엄격한 정책을 유지합니다.
  const scriptPolicy = env.isProduction ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'";
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; "
      + `${scriptPolicy}; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; `
      + "font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https: wss:; worker-src 'self' blob:"
  );
  if (env.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
};

export const enforceHttps: RequestHandler = (req, res, next) => {
  if (!env.enforceHttps || req.secure || req.get('x-forwarded-proto') === 'https') {
    next();
    return;
  }
  if (safeMethods.has(req.method)) {
    res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    return;
  }
  next(new ApiError(400, 'HTTPS 연결이 필요합니다.', 'HTTPS_REQUIRED'));
};

type RateBucket = { count: number; resetAt: number };
const buckets = new Map<string, RateBucket>();

const rateCategory = (req: Request) => {
  if (req.path === '/api/auth/login') return { name: 'login', limit: 30, windowMs: 10 * 60_000 };
  if (req.path.startsWith('/api/auth/')) return { name: 'auth', limit: 60, windowMs: 10 * 60_000 };
  if (/\/search(?:\/|$)/.test(req.path)) return { name: 'search', limit: 300, windowMs: 60_000 };
  if (req.method !== 'GET' && /\/photos(?:\/|$)/.test(req.path)) {
    return { name: 'photo-upload', limit: 20, windowMs: 10 * 60_000 };
  }
  if (/^\/api\/admin\/db\/(?:validate|upload|assets)/.test(req.path) && req.method !== 'GET') {
    return { name: 'upload', limit: 20, windowMs: 10 * 60_000 };
  }
  if (req.path.startsWith('/api/admin/')) return { name: 'admin', limit: 300, windowMs: 10 * 60_000 };
  return null;
};

export const apiRateLimit: RequestHandler = (req, res, next) => {
  const policy = rateCategory(req);
  if (!policy) {
    next();
    return;
  }
  const now = Date.now();
  const key = `${policy.name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + policy.windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  res.setHeader('RateLimit-Limit', String(policy.limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, policy.limit - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > policy.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    securityLog(req, { action: 'SECURITY_RATE_LIMITED', metadata: { category: policy.name, path: req.path } });
    next(new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 'RATE_LIMITED'));
    return;
  }
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  next();
};

export const noStore: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
