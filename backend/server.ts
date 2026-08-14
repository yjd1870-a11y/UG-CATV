import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './app';
import { initializeDatabase } from './db';
import { env, projectRoot } from './env';
import { resumeStraightMapRenders, upgradeOutdatedStraightMapRenders } from './straight-map-pipeline';

await initializeDatabase();
// Windows uses desktop Excel; Linux uses the portable SVG renderer. In both
// environments unfinished map versions must resume after a restart.
resumeStraightMapRenders();

const app = createApiApp();
const apiOnly = process.argv.includes('--api-only');

if (!apiOnly) {
  if (env.nodeEnv === 'production') {
    const distPath = path.join(projectRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    const vite = await createViteServer({
      root: projectRoot,
      server: { middlewareMode: true },
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
  setImmediate(upgradeOutdatedStraightMapRenders);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
