import express from 'express';
import { errorHandler, fail, success } from './http';
import { registerApiModules } from './modules/registry';
import { apiRateLimit, corsPolicy, csrfProtection, enforceHttps, securityHeaders } from './security/middleware';
import { env } from './env';
import { db } from './db';

export const createApiApp = () => {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', 1);
  app.use(enforceHttps);
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(csrfProtection);
  app.use(apiRateLimit);
  app.use(express.json({ limit: env.jsonBodyLimit, strict: true }));

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1 AS healthy').get();
      success(res, { status: 'ok', database: 'ok', storage: env.storageDriver });
    } catch (error) {
      console.error('[HEALTH_CHECK_FAILED]', error);
      res.status(503).json({ success: false, data: { status: 'error' } });
    }
  });
  registerApiModules(app);

  app.use('/api', (_req, res) => fail(res, '요청한 API를 찾을 수 없습니다.', 404, 'NOT_FOUND'));
  app.use(errorHandler);
  return app;
};
