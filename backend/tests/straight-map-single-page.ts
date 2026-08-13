import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { stitchStraightMapPages } from '../straight-map-renderer';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'catv-straight-map-single-page-'));
const sourcePath = path.join(temporaryDirectory, 'page-1.png');
const stitchedPath = path.join(temporaryDirectory, 'stitched.png');

try {
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: '#ffffff' },
  }).png().toFile(sourcePath);
  await stitchStraightMapPages([sourcePath], 1, stitchedPath);
  const metadata = await sharp(stitchedPath).metadata();
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
  console.log('Straight-map single-page test passed: one-page Excel map renders without multi-image join.');
} finally {
  const resolved = path.resolve(temporaryDirectory);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, { recursive: true, force: true });
}
