import { db } from './db';
import { ApiError } from './http';
import { removeMaterialPhoto } from './material-photo-storage';

type MaterialPhotoRow = {
  id: string;
  transaction_id: string;
  object_key: string;
  thumbnail_object_key: string | null;
};

const activePhotosForTransaction = (transactionId: string) => db.prepare(`
  SELECT id,transaction_id,object_key,thumbnail_object_key
    FROM material_photo_assets
   WHERE transaction_id=? AND archive_status<>'DELETED' AND deleted_at IS NULL
   ORDER BY photo_slot
`).all(transactionId) as MaterialPhotoRow[];

const purgeOne = async (photo: MaterialPhotoRow, actorId: string | null, reason: string) => {
  db.prepare("UPDATE material_photo_assets SET purge_status='PENDING',last_purge_error=NULL WHERE id=?")
    .run(photo.id);
  try {
    await removeMaterialPhoto(photo.object_key);
    if (photo.thumbnail_object_key) await removeMaterialPhoto(photo.thumbnail_object_key);
    db.prepare(`
      UPDATE material_photo_assets
         SET archive_status='DELETED',purge_status='DELETED',deleted_at=CURRENT_TIMESTAMP,
             deleted_by=?,delete_reason=?,last_purge_error=NULL
       WHERE id=?
    `).run(actorId, reason, photo.id);
  } catch (error) {
    db.prepare(`
      UPDATE material_photo_assets
         SET purge_status='FAILED',purge_attempts=purge_attempts+1,last_purge_error=?
       WHERE id=?
    `).run(error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), photo.id);
    throw new ApiError(503, '자재 사진 저장소 삭제에 실패했습니다. 자재 이력은 유지되며 다시 시도할 수 있습니다.', 'MATERIAL_PHOTO_PURGE_FAILED');
  }
};

export const purgeMaterialTransactionPhotos = async (transactionId: string, actorId: string | null, reason: string) => {
  const photos = activePhotosForTransaction(transactionId);
  for (const photo of photos) await purgeOne(photo, actorId, reason);
  return photos.length;
};

export const purgeExpiredMaterialPhotos = async (actorId: string | null = null) => {
  const rows = db.prepare(`
    SELECT p.id,p.transaction_id,p.object_key,p.thumbnail_object_key
      FROM material_photo_assets p
      JOIN inventory_transactions t ON t.id=p.transaction_id
      JOIN inventory_month_closures c
        ON c.period_key=substr(t.effective_date,1,7) AND c.status='CLOSED'
     WHERE p.archive_status='EXPORTED'
       AND p.delete_after IS NOT NULL
       AND datetime(p.delete_after)<=CURRENT_TIMESTAMP
       AND p.deleted_at IS NULL
     ORDER BY p.delete_after,p.id
  `).all() as MaterialPhotoRow[];
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await purgeOne(row, actorId, '월마감 사진 보존기간 30일 경과');
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { candidates: rows.length, purged, failed };
};

export const materialPhotoOrphanReport = () => {
  const rows = db.prepare(`
    SELECT p.id,p.transaction_id AS transactionId,p.photo_slot AS photoSlot,p.object_key AS objectKey,
           p.thumbnail_object_key AS thumbnailObjectKey,p.archive_status AS archiveStatus,p.purge_status AS purgeStatus,
           t.status AS transactionStatus,t.effective_date AS effectiveDate
      FROM material_photo_assets p
      LEFT JOIN inventory_transactions t ON t.id=p.transaction_id
     WHERE p.deleted_at IS NULL
       AND (t.id IS NULL OR t.status='REVERSED')
     ORDER BY t.effective_date,p.transaction_id,p.photo_slot
  `).all();
  return { count: rows.length, rows };
};

export const photoStorageSummary = () => {
  const material = db.prepare(`
    SELECT COUNT(*) AS objects,COALESCE(SUM(file_size+COALESCE(thumbnail_size,0)),0) AS bytes
      FROM material_photo_assets WHERE deleted_at IS NULL AND archive_status<>'DELETED'
  `).get() as { objects: number; bytes: number };
  const history = db.prepare(`
    SELECT COUNT(*) AS objects,COALESCE(SUM(file_size+thumbnail_size),0) AS bytes
      FROM cell_history_photo_assets WHERE deleted_at IS NULL AND purge_status<>'DELETED'
  `).get() as { objects: number; bytes: number };
  const bytes = Number(material.bytes) + Number(history.bytes);
  const gigabytes = bytes / (1024 ** 3);
  return {
    bytes,
    gigabytes: Number(gigabytes.toFixed(3)),
    estimatedObjects: (Number(material.objects) + Number(history.objects)) * 2,
    warningLevel: gigabytes >= 8.5 ? 'CRITICAL' : gigabytes >= 7 ? 'WARNING' : 'NORMAL',
    thresholdsGb: { warning: 7, critical: 8.5 },
    materialBytes: Number(material.bytes),
    cellHistoryBytes: Number(history.bytes),
  };
};
