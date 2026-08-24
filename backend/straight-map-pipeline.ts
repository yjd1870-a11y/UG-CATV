import { db } from './db';
import { normalizeStationName } from './catv';
import { invalidateStraightMapSearchCache } from './straight-map-cache';
import { removeStraightMap, removeStraightMapSource } from './straight-map-storage';

type StoredVersion = { mapId: string; sourcePath: string };

const removeUnreferencedLegacySources = (sourcePaths: Iterable<string>) => {
  for (const sourcePath of new Set(sourcePaths)) {
    if (sourcePath.startsWith('r2://')) continue;
    const referenced = db.prepare('SELECT 1 FROM map_versions WHERE original_file_path = ? LIMIT 1').get(sourcePath);
    if (!referenced) {
      try { removeStraightMapSource(sourcePath); }
      catch (error) { console.warn('[STRAIGHT_MAP_SOURCE_CLEANUP_FAILED]', sourcePath, error); }
    }
  }
};

/** Explicit administrator deletion; immutable v3 artifacts remain available for cache reuse. */
export const deleteStraightMapsForStation = (stationName: string) => {
  const stationKey = normalizeStationName(stationName);
  if (!stationKey) return { deletedMapCount: 0, deletedVersionCount: 0 };
  const versions = db.prepare(`
    SELECT map_id AS mapId, original_file_path AS sourcePath FROM map_versions WHERE station_key = ?
  `).all(stationKey) as StoredVersion[];
  db.prepare(`
    UPDATE straight_map_jobs SET status = CASE WHEN lease_owner IS NULL THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,
           cancelled_at = CASE WHEN lease_owner IS NULL THEN CURRENT_TIMESTAMP ELSE cancelled_at END
     WHERE station_key = ? AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
  `).run(stationKey);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM map_versions WHERE station_key = ?').run(stationKey);
    db.prepare('DELETE FROM straight_maps WHERE station_key = ?').run(stationKey);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const mapId of new Set(versions.map((version) => version.mapId))) removeStraightMap(mapId);
  removeUnreferencedLegacySources(versions.map((version) => version.sourcePath));
  invalidateStraightMapSearchCache();
  return { deletedMapCount: new Set(versions.map((version) => version.mapId)).size, deletedVersionCount: versions.length };
};

export const deleteAllStraightMaps = () => {
  const versions = db.prepare('SELECT map_id AS mapId, original_file_path AS sourcePath FROM map_versions').all() as StoredVersion[];
  db.prepare(`
    UPDATE straight_map_jobs SET status = CASE WHEN lease_owner IS NULL THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,
           cancelled_at = CASE WHEN lease_owner IS NULL THEN CURRENT_TIMESTAMP ELSE cancelled_at END
     WHERE status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
  `).run();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM map_versions').run();
    db.prepare('DELETE FROM straight_maps').run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const mapId of new Set(versions.map((version) => version.mapId))) removeStraightMap(mapId);
  removeUnreferencedLegacySources(versions.map((version) => version.sourcePath));
  invalidateStraightMapSearchCache();
  return { deletedMapCount: new Set(versions.map((version) => version.mapId)).size, deletedVersionCount: versions.length };
};
