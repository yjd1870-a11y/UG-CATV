import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { db, initializeDatabase } from '../db';
import { deleteStraightMapsForStation, registerStraightMapUpload, upgradeOutdatedStraightMapRenders } from '../straight-map-pipeline';
import { extractStraightMapSheets, STRAIGHT_MAP_RENDERER_REVISION } from '../straight-map-ooxml';
import { normalizeStraightMapCompactText } from '../straight-map-search';
import { saveStraightMapSharedSource, straightMapVersionRoot } from '../straight-map-storage';

await initializeDatabase();
const sheetName = 'REUSE MAP';
const files: Record<string, Uint8Array> = {
  'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>REUSE-CELL-001</t></is></c></row></sheetData><drawing r:id="rIdDrawing"/></worksheet>'),
  'xl/worksheets/_rels/sheet1.xml.rels': strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rIdDrawing" Target="../drawings/drawing1.xml"/></Relationships>'),
  'xl/drawings/drawing1.xml': strToU8('<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="42" name="REUSE SHAPE"/></xdr:nvSpPr><xdr:spPr/><xdr:txBody><a:p><a:r><a:t>REUSE123456</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'),
};
const buffer = Buffer.from(zipSync(files));
const extraction = extractStraightMapSheets(buffer)[0];
assert.ok(extraction);

const suffix = Date.now().toString(36);
const stationName = `REUSE-${suffix}`;
const stationKey = stationName.toLowerCase();
const mapId = randomUUID();
const versionId = randomUUID();
const sourceHash = createHash('sha256').update(buffer).digest('hex');
const sourcePath = saveStraightMapSharedSource(sourceHash, buffer);
const versionRoot = straightMapVersionRoot(mapId, 1);
fs.mkdirSync(path.join(versionRoot, 'tiles', '7'), { recursive: true });
fs.writeFileSync(path.join(versionRoot, 'tiles', '7', '0_0.webp'), 'reused-tile');

db.prepare(`
  INSERT INTO map_versions (
    id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash,
    sheet_name, map_width, map_height, rendered_width, rendered_height, tile_size, max_zoom, status,
    renderer_revision
  ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 100, 100, 256, 7, 'ACTIVE', ?)
`).run(versionId, mapId, sheetName, 'reusemap', stationKey, sourcePath, sourceHash, sheetName, extraction.mapWidth, extraction.mapHeight, STRAIGHT_MAP_RENDERER_REVISION);
const insertObject = db.prepare(`
  INSERT INTO map_objects (
    id, map_id, version_id, shape_id, shape_name, object_type, original_text,
    normalized_text, compact_text, x, y, width, height, center_x, center_y,
    x_ratio, y_ratio, group_id, rotation, shape_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const item of extraction.objects) {
  insertObject.run(randomUUID(), mapId, versionId, item.shapeId, item.shapeName, item.objectType, item.originalText,
    item.normalizedText, normalizeStraightMapCompactText(item.normalizedText), item.x, item.y, item.width, item.height,
    item.centerX, item.centerY, 0.25, 0.35, item.groupId, item.rotation, item.shapeHash);
}

try {
  const result = registerStraightMapUpload({ mapName: stationName, fileName: 'REUSE.xlsx', fileBase64: buffer.toString('base64') });
  assert.equal(result.mapCount, 1);
  assert.equal(result.reusedMapCount, 1);
  const deadline = Date.now() + 5_000;
  let latest: { id: string; version: number; status: string } | undefined;
  while (Date.now() < deadline) {
    latest = db.prepare(`
      SELECT id, version, status FROM map_versions WHERE map_id = ? ORDER BY version DESC LIMIT 1
    `).get(mapId) as typeof latest;
    if (latest?.status === 'ACTIVE') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(latest?.version, 2);
  assert.equal(latest?.status, 'ACTIVE');
  assert.equal((db.prepare('SELECT status FROM map_versions WHERE id = ?').get(versionId) as { status: string }).status, 'ARCHIVED');
  assert.equal(fs.readFileSync(path.join(straightMapVersionRoot(mapId, 2), 'tiles', '7', '0_0.webp'), 'utf8'), 'reused-tile');
  const coordinates = db.prepare('SELECT x_ratio AS xRatio, y_ratio AS yRatio FROM map_objects WHERE version_id = ?').all(latest?.id) as Array<{ xRatio: number; yRatio: number }>;
  assert.ok(coordinates.length > 0 && coordinates.every((point) => point.xRatio === 0.25 && point.yRatio === 0.35));
  db.prepare("UPDATE map_versions SET renderer_revision = '' WHERE id = ?").run(latest?.id);
  process.env.STRAIGHT_MAP_RENDERER = 'portable';
  upgradeOutdatedStraightMapRenders();
  const upgradeDeadline = Date.now() + 5_000;
  let upgraded: { id: string; version: number; status: string; rendererRevision: string } | undefined;
  while (Date.now() < upgradeDeadline) {
    upgraded = db.prepare(`
      SELECT id, version, status, renderer_revision AS rendererRevision
        FROM map_versions WHERE map_id = ? ORDER BY version DESC LIMIT 1
    `).get(mapId) as typeof upgraded;
    if (upgraded?.status === 'ACTIVE') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(upgraded?.version, 3);
  assert.equal(upgraded?.status, 'ACTIVE');
  assert.equal(upgraded?.rendererRevision, STRAIGHT_MAP_RENDERER_REVISION);
  console.log('Straight-map reupload test passed: reused tiles and automatic renderer revision upgrade verified');
} finally {
  deleteStraightMapsForStation(stationName);
}
