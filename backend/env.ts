import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(backendDir, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const databaseValue = process.env.DATABASE_PATH || 'backend/data/catv.sqlite';
const privateStorageValue = process.env.PRIVATE_STORAGE_PATH || 'backend/data';

const numberValue = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

const booleanValue = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
};

const nodeEnv = process.env.NODE_ENV || 'development';
const cookieSameSite = (process.env.SESSION_COOKIE_SAME_SITE || 'strict').toLowerCase();
if (!['strict', 'lax', 'none'].includes(cookieSameSite)) {
  throw new Error('SESSION_COOKIE_SAME_SITE must be strict, lax, or none.');
}

const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const developmentOrigins = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];
const adminOrigins = (process.env.ADMIN_MUTATION_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: numberValue('PORT', 3000, 1, 65_535),
  databasePath: path.isAbsolute(databaseValue)
    ? databaseValue
    : path.resolve(projectRoot, databaseValue),
  privateStoragePath: path.isAbsolute(privateStorageValue)
    ? privateStorageValue
    : path.resolve(projectRoot, privateStorageValue),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  sessionTtlHours: numberValue('SESSION_TTL_HOURS', 12, 1, 168),
  cookieName: process.env.SESSION_COOKIE_NAME || 'catv_session',
  cookieSameSite: cookieSameSite as 'strict' | 'lax' | 'none',
  storageUrl: process.env.STORAGE_URL || '/uploads',
  corsAllowedOrigins: new Set(configuredOrigins.length ? configuredOrigins : (nodeEnv === 'production' ? [] : developmentOrigins)),
  adminMutationAllowedOrigins: new Set(adminOrigins.length ? adminOrigins : configuredOrigins),
  trustProxy: booleanValue('TRUST_PROXY', nodeEnv === 'production'),
  enforceHttps: booleanValue('ENFORCE_HTTPS', nodeEnv === 'production'),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '30mb',
  loginFailureLimit: numberValue('LOGIN_FAILURE_LIMIT', 5, 3, 50),
  loginWindowMinutes: numberValue('LOGIN_WINDOW_MINUTES', 10, 1, 1440),
  bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME || '',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME || 'System Administrator',
};

if (env.isProduction && Buffer.byteLength(env.sessionSecret, 'utf8') < 32) {
  throw new Error('SESSION_SECRET must be configured with at least 32 bytes in production.');
}
if (env.isProduction && env.corsAllowedOrigins.size === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS must list the production frontend origin(s).');
}
if (env.cookieSameSite === 'none' && !env.isProduction) {
  console.warn('[SECURITY_CONFIG] SameSite=None cookies require HTTPS and are intended for cross-site production deployments.');
}
