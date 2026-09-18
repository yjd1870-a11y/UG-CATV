import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.MATERIAL_MANAGEMENT_ENABLED = 'false';
const [{ createApiApp }, { initializeDatabase }] = await Promise.all([
  import('../app'),
  import('../db'),
]);
await initializeDatabase();
const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  const base = `http://127.0.0.1:${address.port}/api`;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'user-5', password: '1234' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  const disabled = await fetch(`${base}/material-management/field/categories`, { headers: { Cookie: cookie } });
  const payload = await disabled.json() as { code?: string };
  assert.equal(disabled.status, 503);
  assert.equal(payload.code, 'MATERIAL_MANAGEMENT_DISABLED');
  console.log('Material dark-launch test passed: backend API remains unavailable while the flag is off');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
