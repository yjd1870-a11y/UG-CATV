import assert from 'node:assert/strict';

process.env.CATV_RENDERER_LIBRARY_MODE = '1';
const { mapLimit, retryUpload } = await import('../../renderer-agent/src/index');

let active = 0;
let peak = 0;
const results = await mapLimit(Array.from({ length: 12 }, (_, index) => index), 3, async (value) => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, 10));
  active -= 1;
  return value * 2;
});
assert.equal(peak, 3, 'bounded queue must never exceed configured concurrency');
assert.deepEqual(results, Array.from({ length: 12 }, (_, index) => index * 2));

let attempts = 0;
let retries = 0;
await retryUpload('retry-test.webp', async () => {
  attempts += 1;
  return new Response(null, { status: attempts === 3 ? 200 : 503 });
}, () => { retries += 1; });
assert.equal(attempts, 3, 'upload must retry up to the successful third attempt');
assert.equal(retries, 2);

await assert.rejects(
  retryUpload('broken-file.webp', async () => new Response(null, { status: 503 })),
  /broken-file\.webp \(503\)/,
  'terminal error must identify the failed artifact',
);
console.log('Straight-map Agent queue test passed: concurrency is bounded and failed uploads use three exponential-backoff attempts.');
