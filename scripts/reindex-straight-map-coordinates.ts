import fs from 'node:fs';
import { db, initializeDatabase } from '../backend/db';
import { normalizeStationName } from '../backend/catv';
import { extractStraightMapSheets } from '../backend/straight-map-ooxml';
import { normalizeStraightMapCompactText } from '../backend/straight-map-search';

await initializeDatabase();
const requestedStation = normalizeStationName(process.argv[2] || '');
const versions = db.prepare(`
  SELECT id, station_key AS stationKey, map_key AS mapKey, original_file_path AS sourcePath
    FROM map_versions
   WHERE status = 'ACTIVE' AND (? = '' OR station_key = ?)
`).all(requestedStation, requestedStation) as Array<{ id: string; stationKey: string; mapKey: string; sourcePath: string }>;
const bySource = new Map<string, typeof versions>();
for (const version of versions) bySource.set(version.sourcePath, [...(bySource.get(version.sourcePath) || []), version]);

db.exec('BEGIN IMMEDIATE');
try {
  const updateVersion = db.prepare('UPDATE map_versions SET map_width = ?, map_height = ? WHERE id = ?');
  const updateObject = db.prepare(`
    UPDATE map_objects
       SET normalized_text = ?, compact_text = ?, x = ?, y = ?, width = ?, height = ?,
           center_x = ?, center_y = ?, x_ratio = ?, y_ratio = ?, rotation = ?, shape_hash = ?
     WHERE version_id = ? AND shape_id = ? AND original_text = ?
  `);
  for (const [sourcePath, sourceVersions] of bySource) {
    const extractions = extractStraightMapSheets(fs.readFileSync(sourcePath));
    const byMap = new Map(extractions.map((sheet) => [normalizeStationName(sheet.sheetName), sheet]));
    for (const version of sourceVersions) {
      const extraction = byMap.get(version.mapKey);
      if (!extraction) continue;
      updateVersion.run(extraction.mapWidth, extraction.mapHeight, version.id);
      for (const item of extraction.objects) {
        updateObject.run(
          item.normalizedText, normalizeStraightMapCompactText(item.normalizedText), item.x, item.y,
          item.width, item.height, item.centerX, item.centerY, item.xRatio, item.yRatio,
          item.rotation, item.shapeHash, version.id, item.shapeId, item.originalText
        );
      }
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`[STRAIGHT_MAP_REINDEX] ${versions.length}개 ACTIVE 시트 좌표를 실제 도형 경계 기준으로 갱신했습니다.`);
