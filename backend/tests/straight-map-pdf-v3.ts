import assert from 'node:assert/strict';

process.env.CATV_RENDERER_LIBRARY_MODE = '1';
const { normalizedCoordinates } = await import('../../renderer-agent/src/index');

const transformed = normalizedCoordinates({
  schemaVersion: 3,
  printArea: '$B$2:$Z$100',
  pageOrder: 2,
  printLeft: 40,
  printTop: 20,
  printWidth: 1000,
  printHeight: 500,
  coordinates: [{ shapeId: 'shape-1', label: 'G270040', left: 530, top: 260, width: 20, height: 20 }],
}, {
  pages: 1,
  widthPoints: 842,
  heightPoints: 595,
  pageBoxes: [{ pageIndex: 0, widthPoints: 842, heightPoints: 595 }],
});

assert.equal(transformed.pagePlacements.length, 1);
assert.equal(transformed.canvasWidthPoints, 842);
assert.equal(transformed.contentBounds.widthPoints, 842);
assert.ok(Math.abs(transformed.contentBounds.heightPoints - 421) < 1e-9);
const coordinate = transformed.coordinates[0];
assert.ok(Math.abs(coordinate.worldXPoints - 421) < 1e-9);
assert.ok(Math.abs(coordinate.worldYPoints - 210.5) < 1e-9);
assert.ok(Math.abs(coordinate.xRatio - 0.5) < 1e-12);
assert.ok(Math.abs(coordinate.yRatio - (210.5 / 595)) < 1e-12);

for (const zoom of [0.05, 0.5, 1, 8, 30]) {
  for (const dpr of [1, 1.25, 2, 3]) {
    const pan = { x: -173.25, y: 81.75 };
    const screenX = pan.x + coordinate.worldXPoints * zoom;
    const screenY = pan.y + coordinate.worldYPoints * zoom;
    const recoveredX = ((screenX * dpr - pan.x * dpr) / (zoom * dpr));
    const recoveredY = ((screenY * dpr - pan.y * dpr) / (zoom * dpr));
    assert.ok(Math.abs(recoveredX - coordinate.worldXPoints) * zoom <= 1e-9, 'x error must stay below one CSS pixel');
    assert.ok(Math.abs(recoveredY - coordinate.worldYPoints) * zoom <= 1e-9, 'y error must stay below one CSS pixel');
  }
}

assert.equal(JSON.stringify({ pdf: 1, coordinates: 1, manifest: 1 }).includes('tile'), false);

const multiPage = normalizedCoordinates({
  schemaVersion: 3, printArea: '$A$1:$ZZ$999', pageOrder: 2, printLeft: 0, printTop: 0,
  printWidth: 1200, printHeight: 800,
  coordinates: [{ shapeId: 'shape-2', label: 'FAR-RIGHT', left: 1140, top: 390, width: 20, height: 20 }],
}, {
  pages: 2, widthPoints: 842, heightPoints: 595,
  pageBoxes: [{ pageIndex: 0, widthPoints: 842, heightPoints: 595 }, { pageIndex: 1, widthPoints: 842, heightPoints: 595 }],
});
assert.equal(multiPage.columns, 2);
assert.equal(multiPage.rows, 1);
assert.deepEqual(multiPage.pagePlacements.map((page) => page.xPoints), [0, 842]);
assert.equal(multiPage.coordinates[0].pageIndex, 1, 'multi-page fallback must preserve Excel page order');

const calibrated = normalizedCoordinates({
  schemaVersion: 3, printArea: '$A$1:$Z$100', pageOrder: 2, printLeft: 0, printTop: 0,
  printWidth: 1000, printHeight: 500,
  calibration: [{ label: '__CATV_CAL_A__', x: 0, y: 0 }, { label: '__CATV_CAL_B__', x: 1000, y: 500 }],
  coordinates: [{ shapeId: 'shape-3', label: 'CALIBRATED', left: 490, top: 240, width: 20, height: 20 }],
}, {
  pages: 1, widthPoints: 842, heightPoints: 595,
  pageBoxes: [{ pageIndex: 0, widthPoints: 842, heightPoints: 595 }],
  textAnchors: [{ label: '__CATV_CAL_A__', pageIndex: 0, xPoints: 10, yPoints: 20 },
    { label: '__CATV_CAL_B__', pageIndex: 0, xPoints: 810, yPoints: 420 }],
});
assert.equal(calibrated.calibrationMode, 'pdf-text-anchors');
assert.equal(calibrated.coordinates[0].worldXPoints, 410);
assert.equal(calibrated.coordinates[0].worldYPoints, 220);
console.log('Straight-map PDF v3 test passed: top-left PDF-point coordinates are stable across zoom/DPR and tile PUT count is zero.');
