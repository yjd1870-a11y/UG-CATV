import assert from 'node:assert/strict';
import { proxyApiRequest } from '../../functions/api/[[path]]';

let capturedUrl = '';
let capturedInit: RequestInit | undefined;
const upstreamHeaders = new Headers({
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'private, no-store',
  'Content-Range': 'bytes 0-3/10',
  'Content-Type': 'application/pdf',
  'Set-Cookie': 'catv_session=test-token; HttpOnly; Path=/; SameSite=None; Secure',
});

const response = await proxyApiRequest(
  new Request('https://ugt-transmission-network.pages.dev/api/straight-maps/map-1/pdf?version=2', {
    headers: {
      Cookie: 'catv_session=test-token',
      Origin: 'https://ugt-transmission-network.pages.dev',
      Range: 'bytes=0-3',
      'X-Forwarded-For': 'spoofed',
    },
  }),
  'https://ratis-transmission-webapp-yjd1870.onrender.com',
  async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response('test', { status: 206, headers: upstreamHeaders });
  },
);

assert.equal(capturedUrl, 'https://ratis-transmission-webapp-yjd1870.onrender.com/api/straight-maps/map-1/pdf?version=2');
assert.equal(capturedInit?.method, 'GET');
const forwardedHeaders = new Headers(capturedInit?.headers);
assert.equal(forwardedHeaders.get('cookie'), 'catv_session=test-token');
assert.equal(forwardedHeaders.get('origin'), 'https://ugt-transmission-network.pages.dev');
assert.equal(forwardedHeaders.get('range'), 'bytes=0-3');
assert.equal(forwardedHeaders.has('x-forwarded-for'), false);
assert.equal(capturedInit?.redirect, 'manual');
assert.equal(response.status, 206);
assert.equal(response.headers.get('accept-ranges'), 'bytes');
assert.equal(response.headers.get('content-range'), 'bytes 0-3/10');
assert.match(response.headers.get('set-cookie') || '', /catv_session=test-token/);
assert.equal(await response.text(), 'test');

const invalidPath = await proxyApiRequest(new Request('https://ugt-transmission-network.pages.dev/not-api'));
assert.equal(invalidPath.status, 404);

const invalidMethod = await proxyApiRequest(new Request('https://ugt-transmission-network.pages.dev/api/auth/me', { method: 'PURGE' }));
assert.equal(invalidMethod.status, 405);

console.log('[pages-api-proxy] passed');
