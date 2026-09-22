import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './app';
import { initializeDatabase } from './db';
import { env, projectRoot } from './env';
import { photoStorageSummary, purgeExpiredMaterialPhotos } from './material-photo-retention';

await initializeDatabase();

const app = createApiApp();
const apiOnly = process.argv.includes('--api-only');

if (!apiOnly) {
  if (env.nodeEnv === 'production') {
    const distPath = path.join(projectRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    const privateStorageWatchGlob = `${path.relative(projectRoot, env.privateStoragePath).replace(/\\/g, '/')}/**`;
    const vite = await createViteServer({
      root: projectRoot,
      server: {
        middlewareMode: true,
        watch: { ignored: [privateStorageWatchGlob, '**/.tmp/**'] },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
}

const requestedPort = apiOnly ? Number(process.env.API_PORT || 3001) : env.port;
const server = http.createServer(app);
server.listen(requestedPort, '0.0.0.0', () => {
  console.log(`[CATV] ${apiOnly ? 'API' : 'Web + API'} server: http://localhost:${requestedPort}`);
  console.log(`[CATV] Database: ${env.databasePath}`);
  void purgeExpiredMaterialPhotos().then((result) => {
    console.log('[CATV] Material photo retention startup run:', result, photoStorageSummary());
  }).catch((error) => console.error('[CATV] Material photo retention startup run failed:', error));
});

const retentionTimer = setInterval(() => {
  void purgeExpiredMaterialPhotos().then((result) => {
    console.log('[CATV] Material photo retention daily run:', result, photoStorageSummary());
  }).catch((error) => console.error('[CATV] Material photo retention daily run failed:', error));
}, 24 * 60 * 60 * 1000);
retentionTimer.unref();

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
