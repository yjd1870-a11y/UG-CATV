import { createHash, randomUUID } from 'node:crypto';
import { db } from './db';
import { normalizeStationName } from './catv';
import { extractStraightMapSheets } from './straight-map-ooxml';
import { renderStraightMap } from './straight-map-renderer';
import {
  cloneStraightMapVersion,
  removeStraightMap,
  removeStraightMapSource,
  removeStraightMapVersion,
  saveStraightMapSharedSource,
} from './straight-map-storage';
import { normalizeStraightMapCompactText } from './straight-map-search';
import { invalidateStraightMapSearchCache } from './straight-map-cache';

const renderQueue: string[] = [];
const queuedVersions = new Set<string>();
const cancelledVersions = new Set<string>();
const cancelledArtifacts = new Map<string, { mapId: string; version: number }>();
let renderWorkerActive = false;

const sourceBuffer = (base64: string) => {
  if (!/^[a-z0-9+/=\r\n]+$/i.test(base64)) throw new Error('직선도 XLSX 데이터 형식이 올바르지 않습니다.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('직선도 XLSX 파일은 20MB 이하여야 합니다.');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('직선도 파일이 유효한 XLSX ZIP 형식이 아닙니다.');
  return buffer;
};

export const renderStraightMapVersion = async (versionId: string) => {
  try {
    if (cancelledVersions.has(versionId)) return;
    const version = db.prepare(`
      SELECT id, map_id AS mapId, version, original_file_path AS originalFilePath, sheet_name AS sheetName,
             reuse_version_id AS reuseVersionId
        FROM map_versions WHERE id = ? AND status = 'PROCESSING'
    `).get(versionId) as { id: string; mapId: string; version: number; originalFilePath: string; sheetName: string; reuseVersionId: string | null } | undefined;
    if (!version) return;
    let rendered: {
      width: number;
      height: number;
      tileSize: number;
      maxZoom: number;
      coordinates: Array<{ shapeId: string; label: string; xRatio: number; yRatio: number }>;
    };
    if (version.reuseVersionId) {
      try {
        const prior = db.prepare(`
          SELECT version, rendered_width AS width, rendered_height AS height,
                 tile_size AS tileSize, max_zoom AS maxZoom
            FROM map_versions WHERE id = ? AND map_id = ? AND status IN ('ACTIVE', 'ARCHIVED')
        `).get(version.reuseVersionId, version.mapId) as { version: number; width: number; height: number; tileSize: number; maxZoom: number } | undefined;
        if (!prior?.width || !prior.height || !prior.maxZoom) throw new Error('재사용할 직선도 버전을 찾을 수 없습니다.');
        cloneStraightMapVersion(version.mapId, prior.version, version.version);
        rendered = { width: prior.width, height: prior.height, tileSize: prior.tileSize, maxZoom: prior.maxZoom, coordinates: [] };
      } catch {
        rendered = await renderStraightMap(version.mapId, version.version, version.originalFilePath, version.sheetName);
      }
    } else {
      rendered = await renderStraightMap(version.mapId, version.version, version.originalFilePath, version.sheetName);
    }
    const stillCurrent = db.prepare("SELECT 1 FROM map_versions WHERE id = ? AND status = 'PROCESSING'").get(versionId);
    if (cancelledVersions.has(versionId) || !stillCurrent) {
      removeStraightMapVersion(version.mapId, version.version);
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const updateCoordinate = db.prepare('UPDATE map_objects SET x_ratio = ?, y_ratio = ? WHERE version_id = ? AND shape_id = ?');
      const updateCoordinateByText = db.prepare('UPDATE map_objects SET x_ratio = ?, y_ratio = ? WHERE version_id = ? AND compact_text = ?');
      for (const coordinate of rendered.coordinates) {
        // Excel COM Shape.Id and DrawingML cNvPr id are not guaranteed to
        // identify the same shape after workbook edits. The full printed
        // label is stable and prevents duplicate CELL names from swapping
        // coordinates; use the numeric id only as a legacy fallback.
        const updated = updateCoordinateByText.run(
          coordinate.xRatio, coordinate.yRatio, versionId, normalizeStraightMapCompactText(coordinate.label)
        );
        if (updated.changes === 0) updateCoordinate.run(coordinate.xRatio, coordinate.yRatio, versionId, coordinate.shapeId);
      }
      db.prepare("UPDATE map_versions SET status = 'ARCHIVED' WHERE map_id = ? AND status = 'ACTIVE'").run(version.mapId);
      db.prepare(`
        UPDATE map_versions
           SET status = 'ACTIVE', rendered_width = ?, rendered_height = ?, tile_size = ?, max_zoom = ?,
               activated_at = CURRENT_TIMESTAMP, error_message = NULL
         WHERE id = ? AND status = 'PROCESSING'
      `).run(rendered.width, rendered.height, rendered.tileSize, rendered.maxZoom, versionId);
      db.exec('COMMIT');
      invalidateStraightMapSearchCache();
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    if (cancelledVersions.has(versionId)) return;
    const message = error instanceof Error ? error.message.slice(0, 1000) : '직선도 렌더링 실패';
    // Excel COM cannot start when the web server was launched outside the
    // signed-in desktop session (HRESULT 0x80070520). Keep the version in
    // PROCESSING so search coordinates remain available and the next normal
    // desktop-server start can resume rendering automatically.
    const desktopSessionUnavailable = /(?:0x)?80070520|logon session|로그온 세션/i.test(message);
    if (desktopSessionUnavailable) {
      db.prepare(`
        UPDATE map_versions
           SET status = 'PROCESSING',
               error_message = 'Excel 사용자 세션을 기다리는 중입니다. 서버를 데스크톱 사용자 세션에서 다시 시작하면 자동 재개됩니다.'
         WHERE id = ? AND status = 'PROCESSING'
      `).run(versionId);
      console.warn('[STRAIGHT_MAP_RENDER_WAITING_FOR_EXCEL_SESSION]', versionId);
    } else {
      db.prepare("UPDATE map_versions SET status = 'FAILED', error_message = ? WHERE id = ? AND status = 'PROCESSING'").run(message, versionId);
      console.error('[STRAIGHT_MAP_RENDER_FAILED]', versionId, error);
    }
  } finally {
    const artifact = cancelledArtifacts.get(versionId);
    if (artifact) removeStraightMapVersion(artifact.mapId, artifact.version);
    cancelledVersions.delete(versionId);
    cancelledArtifacts.delete(versionId);
  }
};

const drainRenderQueue = async () => {
  if (renderWorkerActive) return;
  const versionId = renderQueue.shift();
  if (!versionId) return;
  renderWorkerActive = true;
  try { await renderStraightMapVersion(versionId); }
  finally {
    queuedVersions.delete(versionId);
    renderWorkerActive = false;
    setImmediate(() => void drainRenderQueue());
  }
};

export const queueStraightMapRender = (versionId: string) => {
  if (queuedVersions.has(versionId)) return;
  queuedVersions.add(versionId);
  renderQueue.push(versionId);
  setImmediate(() => void drainRenderQueue());
};

export const resumeStraightMapRenders = () => {
  const recoverable = db.prepare(`
    SELECT id FROM map_versions
     WHERE status = 'FAILED' AND error_message LIKE '%80070520%'
  `).all() as Array<{ id: string }>;
  const reset = db.prepare("UPDATE map_versions SET status = 'PROCESSING', error_message = NULL WHERE id = ? AND status = 'FAILED'");
  for (const row of recoverable) reset.run(row.id);
  const rows = db.prepare("SELECT id FROM map_versions WHERE status = 'PROCESSING' ORDER BY created_at, sheet_name").all() as Array<{ id: string }>;
  for (const row of rows) queueStraightMapRender(row.id);
};

type StoredVersion = {
  id: string;
  mapId: string;
  version: number;
  sourcePath: string;
};

const storedVersionsForStation = (stationKey: string) => db.prepare(`
  SELECT id, map_id AS mapId, version, original_file_path AS sourcePath
    FROM map_versions WHERE station_key = ?
`).all(stationKey) as StoredVersion[];

const cancelVersion = (version: StoredVersion) => {
  cancelledVersions.add(version.id);
  cancelledArtifacts.set(version.id, { mapId: version.mapId, version: version.version });
};

const removeUnreferencedSources = (sourcePaths: Iterable<string>) => {
  for (const sourcePath of new Set(sourcePaths)) {
    const referenced = db.prepare('SELECT 1 FROM map_versions WHERE original_file_path = ? LIMIT 1').get(sourcePath);
    if (!referenced) {
      try { removeStraightMapSource(sourcePath); }
      catch (error) { console.warn('[STRAIGHT_MAP_SOURCE_CLEANUP_FAILED]', sourcePath, error); }
    }
  }
};

const removeMapFiles = (mapIds: Iterable<string>) => {
  for (const mapId of new Set(mapIds)) {
    try { removeStraightMap(mapId); }
    catch (error) { console.warn('[STRAIGHT_MAP_CLEANUP_FAILED]', mapId, error); }
  }
};

export const deleteStraightMapsForStation = (stationName: string) => {
  const stationKey = normalizeStationName(stationName);
  if (!stationKey) return { deletedMapCount: 0, deletedVersionCount: 0 };
  const versions = storedVersionsForStation(stationKey);
  for (const version of versions) cancelVersion(version);
  db.prepare('DELETE FROM map_versions WHERE station_key = ?').run(stationKey);
  removeMapFiles(versions.map((version) => version.mapId));
  removeUnreferencedSources(versions.map((version) => version.sourcePath));
  invalidateStraightMapSearchCache();
  return {
    deletedMapCount: new Set(versions.map((version) => version.mapId)).size,
    deletedVersionCount: versions.length,
  };
};

export const deleteAllStraightMaps = () => {
  const versions = db.prepare(`
    SELECT id, map_id AS mapId, version, original_file_path AS sourcePath FROM map_versions
  `).all() as StoredVersion[];
  for (const version of versions) cancelVersion(version);
  db.prepare('DELETE FROM map_versions').run();
  removeMapFiles(versions.map((version) => version.mapId));
  removeUnreferencedSources(versions.map((version) => version.sourcePath));
  invalidateStraightMapSearchCache();
  return {
    deletedMapCount: new Set(versions.map((version) => version.mapId)).size,
    deletedVersionCount: versions.length,
  };
};

type RegisteredMap = {
  id: string;
  mapId: string;
  mapName: string;
  version: number;
  status: string;
  duplicate: boolean;
  reused: boolean;
  objectCount: number;
  changedCount: number;
};

type PriorMapObject = {
  shapeId: string;
  originalText: string;
  shapeHash: string;
  xRatio: number;
  yRatio: number;
};

const changedObjectCount = (currentHashes: string[], priorHashes: string[]) => {
  const remaining = new Map<string, number>();
  for (const hash of priorHashes) remaining.set(hash, (remaining.get(hash) || 0) + 1);
  let changed = 0;
  for (const hash of currentHashes) {
    const count = remaining.get(hash) || 0;
    if (!count) changed += 1;
    else remaining.set(hash, count - 1);
  }
  return changed;
};

const sameObjectSet = (currentHashes: string[], priorHashes: string[]) => (
  currentHashes.length === priorHashes.length && changedObjectCount(currentHashes, priorHashes) === 0
);

export const registerStraightMapUpload = (input: { mapName: string; fileName: string; fileBase64: string }) => {
  if (!/\.xlsx$/i.test(input.fileName)) throw new Error('지도 직선도 변환은 .xlsx 파일만 지원합니다.');
  const buffer = sourceBuffer(input.fileBase64);
  const sourceHash = createHash('sha256').update(buffer).digest('hex');
  const stationKey = normalizeStationName(input.mapName);
  if (!stationKey) throw new Error('직선도 국사명을 확인해주세요.');
  const extractions = extractStraightMapSheets(buffer)
    .filter((sheet) => !sheet.sheetName.replace(/\s+/g, '').includes('선번장'));
  if (!extractions.length) throw new Error('선번장 외 직선도 시트를 찾지 못했습니다.');
  const originalFilePath = saveStraightMapSharedSource(sourceHash, buffer);
  const registered: RegisteredMap[] = [];
  const versionsToRender: string[] = [];
  const currentMapKeys = new Set(extractions.map((sheet) => normalizeStationName(sheet.sheetName)));
  const stationVersions = storedVersionsForStation(stationKey);
  const versionDetails = db.prepare(`
    SELECT id, map_id AS mapId, map_key AS mapKey, version, status, original_file_path AS sourcePath
      FROM map_versions WHERE station_key = ?
  `).all(stationKey) as Array<StoredVersion & { mapKey: string; status: string }>;
  const removedMapIds = new Set(versionDetails.filter((version) => !currentMapKeys.has(version.mapKey)).map((version) => version.mapId));
  const removedVersions = stationVersions.filter((version) => removedMapIds.has(version.mapId));
  const supersededProcessing = versionDetails.filter((version) => version.status === 'PROCESSING' && !removedMapIds.has(version.mapId));
  for (const version of [...removedVersions, ...supersededProcessing]) cancelVersion(version);

  db.exec('BEGIN IMMEDIATE');
  try {
    const insertVersion = db.prepare(`
      INSERT INTO map_versions (
        id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash,
        sheet_name, map_width, map_height, status, reuse_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)
    `);
    const insertObject = db.prepare(`
      INSERT INTO map_objects (
        id, map_id, version_id, shape_id, shape_name, object_type, original_text,
        normalized_text, compact_text, x, y, width, height, center_x, center_y, x_ratio, y_ratio,
        group_id, rotation, shape_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const mapId of removedMapIds) db.prepare('DELETE FROM map_versions WHERE map_id = ?').run(mapId);
    db.prepare(`
      UPDATE map_versions SET status = 'FAILED', error_message = '새 업로드로 대체됨'
       WHERE station_key = ? AND status = 'PROCESSING'
    `).run(stationKey);
    for (const extraction of extractions) {
      const mapKey = normalizeStationName(extraction.sheetName);
      const prior = db.prepare(`
        SELECT map_id AS mapId, MAX(version) AS version FROM map_versions WHERE station_key = ? AND map_key = ?
      `).get(stationKey, mapKey) as { mapId: string | null; version: number | null } | undefined;
      const active = db.prepare(`
        SELECT id, map_id AS mapId, version, map_width AS mapWidth, map_height AS mapHeight,
               rendered_width AS renderedWidth, rendered_height AS renderedHeight, max_zoom AS maxZoom
          FROM map_versions
         WHERE station_key = ? AND map_key = ? AND status = 'ACTIVE'
         ORDER BY version DESC LIMIT 1
      `).get(stationKey, mapKey) as {
        id: string; mapId: string; version: number; mapWidth: number; mapHeight: number;
        renderedWidth: number | null; renderedHeight: number | null; maxZoom: number | null;
      } | undefined;
      const mapId = prior?.mapId || randomUUID();
      const version = Number(prior?.version || 0) + 1;
      const versionId = randomUUID();
      const priorObjects = active ? db.prepare(`
        SELECT shape_id AS shapeId, original_text AS originalText, shape_hash AS shapeHash,
               x_ratio AS xRatio, y_ratio AS yRatio
          FROM map_objects WHERE version_id = ?
      `).all(active.id) as PriorMapObject[] : [];
      const currentHashes = extraction.objects.map((item) => item.shapeHash);
      const priorHashes = priorObjects.map((item) => item.shapeHash);
      const reusable = Boolean(
        active?.renderedWidth && active.renderedHeight && active.maxZoom
        && active.mapWidth === extraction.mapWidth && active.mapHeight === extraction.mapHeight
        && sameObjectSet(currentHashes, priorHashes)
      );
      const changedCount = changedObjectCount(currentHashes, priorHashes);
      insertVersion.run(
        versionId, mapId, extraction.sheetName, mapKey, stationKey, version, originalFilePath,
        sourceHash, extraction.sheetName, extraction.mapWidth, extraction.mapHeight, reusable ? active?.id : null
      );
      const priorByIdentity = new Map(priorObjects.map((item) => [`${item.shapeId}\u001f${item.originalText}`, item]));
      const priorByHash = new Map<string, PriorMapObject[]>();
      for (const item of priorObjects) priorByHash.set(item.shapeHash, [...(priorByHash.get(item.shapeHash) || []), item]);
      for (const item of extraction.objects) {
        const previous = reusable
          ? priorByIdentity.get(`${item.shapeId}\u001f${item.originalText}`) || priorByHash.get(item.shapeHash)?.shift()
          : undefined;
        insertObject.run(randomUUID(), mapId, versionId, item.shapeId, item.shapeName, item.objectType, item.originalText,
          item.normalizedText, normalizeStraightMapCompactText(item.normalizedText), item.x, item.y, item.width, item.height, item.centerX, item.centerY,
          previous?.xRatio ?? item.xRatio, previous?.yRatio ?? item.yRatio, item.groupId, item.rotation, item.shapeHash);
      }
      registered.push({ id: versionId, mapId, mapName: extraction.sheetName, version, status: 'PROCESSING', duplicate: false, reused: reusable, objectCount: extraction.objects.length, changedCount });
      versionsToRender.push(versionId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    for (const version of [...removedVersions, ...supersededProcessing]) {
      cancelledVersions.delete(version.id);
      cancelledArtifacts.delete(version.id);
    }
    removeUnreferencedSources([originalFilePath]);
    throw error;
  }
  removeMapFiles(removedMapIds);
  removeUnreferencedSources(removedVersions.map((version) => version.sourcePath));
  invalidateStraightMapSearchCache();
  for (const versionId of versionsToRender) queueStraightMapRender(versionId);
  const first = registered[0];
  return {
    id: first.id,
    mapId: first.mapId,
    version: Math.max(...registered.map((map) => map.version)),
    status: versionsToRender.length ? 'PROCESSING' : first.status,
    duplicate: false,
    reusedMapCount: registered.filter((map) => map.reused).length,
    mapCount: registered.length,
    objectCount: registered.reduce((sum, map) => sum + map.objectCount, 0),
    changedCount: registered.reduce((sum, map) => sum + map.changedCount, 0),
    maps: registered,
  };
};
