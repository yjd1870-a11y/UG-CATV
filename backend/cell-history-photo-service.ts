import { randomUUID } from 'node:crypto';
import { db } from './db';
import { ApiError } from './http';
import {
  privatePhotoDownloadUrl,
  privatePhotoMime,
  promoteQuarantinedCellHistoryPhoto,
  removePrivatePhoto,
  resolvePrivatePhoto,
  savePrivatePhoto,
} from './photo-storage';
import { usesR2Storage } from './object-storage';

type StoredPhoto = Awaited<ReturnType<typeof savePrivatePhoto>>;

export type CellHistoryPhotoRow = {
  id: string;
  history_id: string;
  cell_id: string;
  display_order: number;
  object_key: string;
  thumbnail_object_key: string;
  purge_status: 'ACTIVE' | 'PENDING' | 'FAILED' | 'DELETED';
};

const activeWhere = "purge_status <> 'DELETED' AND deleted_at IS NULL";

const insertStoredPhoto = (
  historyId: string,
  cellId: string,
  uploadedBy: string,
  stored: StoredPhoto,
) => {
  const occupied = new Set((db.prepare(`
    SELECT display_order FROM cell_history_photo_assets
     WHERE history_id = ? AND ${activeWhere}
  `).all(historyId) as Array<{ display_order: number }>).map((row) => row.display_order));
  const displayOrder = [0, 1, 2].find((order) => !occupied.has(order));
  if (displayOrder === undefined) throw new ApiError(409, '작업이력 사진은 최대 3장까지 등록할 수 있습니다.', 'PHOTO_LIMIT_EXCEEDED');
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cell_history_photo_assets (
      id,history_id,cell_id,display_order,object_key,thumbnail_object_key,mime_type,
      file_size,thumbnail_size,width,height,thumbnail_width,thumbnail_height,
      sha256,thumbnail_sha256,uploaded_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, historyId, cellId, displayOrder, stored.objectKey, stored.thumbnailObjectKey, stored.mimeType,
    stored.size, stored.thumbnailSize, stored.width, stored.height, stored.thumbnailWidth,
    stored.thumbnailHeight, stored.sha256, stored.thumbnailSha256, uploadedBy || null,
  );
  return id;
};

const saveAndInsert = async (
  historyId: string,
  cellId: string,
  uploadedBy: string,
  save: () => Promise<StoredPhoto>,
) => {
  const count = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM cell_history_photo_assets
     WHERE history_id = ? AND ${activeWhere}
  `).get(historyId) as { count: number }).count);
  if (count >= 3) throw new ApiError(409, '작업이력 사진은 최대 3장까지 등록할 수 있습니다.', 'PHOTO_LIMIT_EXCEEDED');
  const stored = await save();
  try {
    return insertStoredPhoto(historyId, cellId, uploadedBy, stored);
  } catch (error) {
    await Promise.all([
      removePrivatePhoto(stored.objectKey).catch(() => undefined),
      removePrivatePhoto(stored.thumbnailObjectKey).catch(() => undefined),
    ]);
    throw error;
  }
};

export const addCellHistoryPhotoFromDataUrl = (
  historyId: string,
  cellId: string,
  uploadedBy: string,
  dataUrl: string,
) => saveAndInsert(historyId, cellId, uploadedBy, () => savePrivatePhoto(dataUrl, uploadedBy, 'cell-history'));

export const addCellHistoryPhotoFromQuarantine = (
  historyId: string,
  cellId: string,
  uploadedBy: string,
  objectKey: string,
  mimeType: string,
) => saveAndInsert(
  historyId,
  cellId,
  uploadedBy,
  () => promoteQuarantinedCellHistoryPhoto(objectKey, mimeType, uploadedBy),
);

export const listCellHistoryPhotos = (historyId: string) => db.prepare(`
  SELECT id,history_id,cell_id,display_order,object_key,thumbnail_object_key,purge_status
    FROM cell_history_photo_assets
   WHERE history_id = ? AND ${activeWhere}
   ORDER BY display_order
`).all(historyId) as CellHistoryPhotoRow[];

export const historyPhotoView = (row: CellHistoryPhotoRow) => ({
  id: row.id,
  url: `/api/cells/${encodeURIComponent(row.cell_id)}/history/${encodeURIComponent(row.history_id)}/photos/${encodeURIComponent(row.id)}/content?variant=thumbnail`,
  masterUrl: `/api/cells/${encodeURIComponent(row.cell_id)}/history/${encodeURIComponent(row.history_id)}/photos/${encodeURIComponent(row.id)}/content`,
});

const markFailed = (id: string, error: unknown) => db.prepare(`
  UPDATE cell_history_photo_assets
     SET purge_status='FAILED',last_purge_error=?,purge_attempts=purge_attempts+1
   WHERE id=?
`).run(error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), id);

export const purgeCellHistoryPhoto = async (row: CellHistoryPhotoRow) => {
  db.prepare("UPDATE cell_history_photo_assets SET purge_status='PENDING',last_purge_error=NULL WHERE id=?")
    .run(row.id);
  try {
    await removePrivatePhoto(row.object_key);
    await removePrivatePhoto(row.thumbnail_object_key);
    db.prepare(`
      UPDATE cell_history_photo_assets
         SET purge_status='DELETED',deleted_at=CURRENT_TIMESTAMP,last_purge_error=NULL
       WHERE id=?
    `).run(row.id);
  } catch (error) {
    markFailed(row.id, error);
    throw new ApiError(503, '사진 저장소 삭제에 실패했습니다. 이력 정보는 유지되며 다시 시도할 수 있습니다.', 'PHOTO_PURGE_FAILED');
  }
};

export const purgeCellHistoryPhotos = async (historyId: string) => {
  const rows = listCellHistoryPhotos(historyId);
  for (const row of rows) await purgeCellHistoryPhoto(row);
  return rows.length;
};

export const getCellHistoryPhoto = (photoId: string, historyId: string, cellId: string) => db.prepare(`
  SELECT id,history_id,cell_id,display_order,object_key,thumbnail_object_key,purge_status
    FROM cell_history_photo_assets
   WHERE id=? AND history_id=? AND cell_id=? AND ${activeWhere}
`).get(photoId, historyId, cellId) as CellHistoryPhotoRow | undefined;

export const cellHistoryPhotoContent = async (row: CellHistoryPhotoRow, thumbnail: boolean) => {
  const objectKey = thumbnail ? row.thumbnail_object_key : row.object_key;
  if (usesR2Storage) return { redirectUrl: await privatePhotoDownloadUrl(objectKey), objectKey };
  return { absolutePath: resolvePrivatePhoto(objectKey), mimeType: privatePhotoMime(objectKey), objectKey };
};
