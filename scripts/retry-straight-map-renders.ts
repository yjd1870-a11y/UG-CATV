import { randomUUID } from 'node:crypto';
import { db, initializeDatabase } from '../backend/db';
import { normalizeStationName } from '../backend/catv';
import { renderStraightMapVersion } from '../backend/straight-map-pipeline';

await initializeDatabase();
const argumentsList = process.argv.slice(2);
const force = argumentsList.includes('--force');
const values = argumentsList.filter((value) => value !== '--force');
const requestedStation = values[0] || '';
const stationKey = normalizeStationName(requestedStation);
const requestedMap = values[1] || '';
const mapKey = normalizeStationName(requestedMap);
const versions = db.prepare(`
  SELECT id, map_id AS mapId, map_name AS mapName, map_key AS mapKey, station_key AS stationKey,
         version, original_file_path AS sourcePath, source_hash AS sourceHash, sheet_name AS sheetName,
         map_width AS mapWidth, map_height AS mapHeight, status
    FROM map_versions
   WHERE (status IN ('FAILED', 'PROCESSING') OR (? = 1 AND status = 'ACTIVE'))
     AND (? = '' OR station_key = ?)
     AND (? = '' OR map_key = ?)
     AND id = (
       SELECT candidate.id FROM map_versions candidate
        WHERE candidate.map_id = map_versions.map_id
          AND (candidate.status IN ('FAILED', 'PROCESSING') OR (? = 1 AND candidate.status = 'ACTIVE'))
        ORDER BY CASE candidate.status WHEN 'ACTIVE' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
                 candidate.version DESC
        LIMIT 1
     )
   ORDER BY created_at, map_name
`).all(force ? 1 : 0, stationKey, stationKey, mapKey, mapKey, force ? 1 : 0) as Array<{
  id: string; mapId: string; mapName: string; mapKey: string; stationKey: string; version: number;
  sourcePath: string; sourceHash: string; sheetName: string; mapWidth: number; mapHeight: number; status: string;
}>;

console.log(`[STRAIGHT_MAP_RETRY] ${versions.length}개 시트 렌더링을 시작합니다.`);
for (let index = 0; index < versions.length; index += 1) {
  const version = versions[index];
  console.log(`[STRAIGHT_MAP_RETRY] ${index + 1}/${versions.length} ${version.mapName}`);
  let renderVersionId = version.id;
  if (force && version.status === 'ACTIVE') {
    renderVersionId = randomUUID();
    const nextVersion = Number((db.prepare('SELECT MAX(version) AS version FROM map_versions WHERE map_id = ?').get(version.mapId) as { version: number }).version) + 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO map_versions (
          id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash,
          sheet_name, map_width, map_height, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING')
      `).run(renderVersionId, version.mapId, version.mapName, version.mapKey, version.stationKey, nextVersion,
        version.sourcePath, version.sourceHash, version.sheetName, version.mapWidth, version.mapHeight);
      db.prepare(`
        INSERT INTO map_objects (
          id, map_id, version_id, shape_id, shape_name, object_type, original_text, normalized_text,
          compact_text, x, y, width, height, center_x, center_y, x_ratio, y_ratio,
          group_id, rotation, shape_hash
        )
        SELECT lower(hex(randomblob(16))), map_id, ?, shape_id, shape_name, object_type, original_text,
               normalized_text, compact_text, x, y, width, height, center_x, center_y, x_ratio, y_ratio,
               group_id, rotation, shape_hash
          FROM map_objects WHERE version_id = ?
      `).run(renderVersionId, version.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } else {
    db.prepare("UPDATE map_versions SET status = 'PROCESSING', error_message = NULL WHERE id = ? AND status IN ('FAILED', 'PROCESSING')").run(renderVersionId);
  }
  await renderStraightMapVersion(renderVersionId);
  const result = db.prepare('SELECT status, error_message AS errorMessage FROM map_versions WHERE id = ?').get(renderVersionId) as { status: string; errorMessage: string | null };
  if (result.status !== 'ACTIVE') throw new Error(`${version.mapName}: ${result.errorMessage || result.status}`);
}
console.log('[STRAIGHT_MAP_RETRY] 모든 직선도 시트가 ACTIVE 상태입니다.');
