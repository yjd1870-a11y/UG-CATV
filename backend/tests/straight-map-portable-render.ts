import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { renderPortableStraightMap } from '../straight-map-renderer';
import type { StraightMapExtraction } from '../straight-map-ooxml';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catv-portable-map-'));
const output = path.join(root, 'map.png');
const extraction: StraightMapExtraction = {
  sheetName: 'TEST MAP',
  mapWidth: 1000,
  mapHeight: 500,
  objects: [{
    shapeId: '42', shapeName: 'CELL', objectType: 'shape',
    originalText: 'B2C-TEST-12345', normalizedText: 'b2c-test-12345',
    x: 400, y: 200, width: 200, height: 100, centerX: 500, centerY: 250,
    xRatio: 0.5, yRatio: 0.5, groupId: null, rotation: 0, shapeHash: 'hash',
  }],
};

try {
  const coordinates = await renderPortableStraightMap(extraction, output);
  const metadata = await sharp(output).metadata();
  assert.equal(coordinates.length, 1);
  assert.equal(coordinates[0].label, 'B2C-TEST-12345');
  assert.equal(coordinates[0].xRatio, 0.5);
  assert.ok((metadata.width || 0) >= 3200);
  assert.ok((metadata.height || 0) >= 1200);
  console.log('Portable straight-map render test passed: SVG/PNG and normalized coordinates generated without Excel');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
