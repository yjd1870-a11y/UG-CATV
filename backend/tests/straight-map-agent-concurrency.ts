import assert from 'node:assert/strict';

process.env.CATV_RENDERER_LIBRARY_MODE = '1';
const { inferPdfPageGrid, mapLimit, normalizedCoordinates, retryUpload } = await import('../../renderer-agent/src/index');

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

const excelCoordinates = {
  printArea: '$A$1:$LU$724', printScale: 0.1, pageOrder: 2,
  printWidth: 12_730.5, printHeight: 10_139,
  // Excel COM can omit all automatic page breaks even though the PDF has
  // multiple pages. This is the production failure reproduced by this test.
  verticalStarts: [0], horizontalStarts: [0], cropLeftPoints: 0, cropTopPoints: 0,
  coordinates: [{ shapeId: '128', label: 'G270040', left: 2_486.769, top: 2_374.769, width: 105.154, height: 41.423 }],
};
const fourPagePdf = { pages: 4, widthPoints: 841.92, heightPoints: 595.32 };
assert.deepEqual(inferPdfPageGrid(excelCoordinates, fourPagePdf), { columns: 2, rows: 2 });
const transformed = normalizedCoordinates(excelCoordinates, fourPagePdf);
assert.equal(transformed.columns, 2);
assert.equal(transformed.rows, 2);
assert.ok(Math.abs(transformed.coordinates[0].xRatio - 0.15082) < 0.0001);
assert.ok(Math.abs(transformed.coordinates[0].yRatio - 0.20119) < 0.0001);

const singlePagePdf = { pages: 1, widthPoints: 841.92, heightPoints: 595.32 };
assert.deepEqual(inferPdfPageGrid({ ...excelCoordinates, printWidth: 8_000, printHeight: 5_000 }, singlePagePdf), { columns: 1, rows: 1 });

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
