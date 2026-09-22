import { db, initializeDatabase } from '../backend/db';
import { addCellHistoryPhotoFromDataUrl, listCellHistoryPhotos } from '../backend/cell-history-photo-service';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const backupConfirmed = args.has('--backup-confirmed');
const batchArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = Math.min(500, Math.max(1, Number(batchArg?.split('=')[1] || 50)));

if (apply && !backupConfirmed) {
  throw new Error('실제 적용 전 SQLite와 R2 백업을 완료한 뒤 --backup-confirmed 옵션을 함께 지정하세요.');
}

await initializeDatabase();

const rows = db.prepare(`
  SELECT h.id,h.cell_id AS cellId,h.photos_json AS photosJson,h.deleted_at AS deletedAt,
         COALESCE(h.created_at,'') AS createdAt,
         (SELECT u.id FROM users u WHERE u.name=h.worker_name AND u.deleted_at IS NULL LIMIT 1) AS uploadedBy
    FROM cell_work_history h
   WHERE h.photos_json IS NOT NULL AND h.photos_json<>'[]'
   ORDER BY h.created_at,h.id
   LIMIT ?
`).all(batchSize) as Array<{
  id: string;
  cellId: string;
  photosJson: string;
  deletedAt: string | null;
  createdAt: string;
  uploadedBy: string | null;
}>;

let activeHistories = 0;
let deletedHistories = 0;
let legacyPhotos = 0;
let uploadedPhotos = 0;
let clearedHistories = 0;
const issues: Array<{ historyId: string; message: string }> = [];

for (const row of rows) {
  let photos: string[];
  try {
    const parsed = JSON.parse(row.photosJson);
    photos = Array.isArray(parsed) ? parsed.filter((photo): photo is string => typeof photo === 'string') : [];
  } catch {
    issues.push({ historyId: row.id, message: 'photos_json JSON 파싱 실패' });
    continue;
  }
  legacyPhotos += photos.length;
  if (row.deletedAt) {
    deletedHistories += 1;
    if (apply) {
      db.prepare("UPDATE cell_work_history SET photos_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      clearedHistories += 1;
    }
    continue;
  }
  activeHistories += 1;
  if (!apply) continue;
  try {
    const existing = listCellHistoryPhotos(row.id).length;
    for (const photo of photos.slice(existing, 3)) {
      await addCellHistoryPhotoFromDataUrl(row.id, row.cellId, row.uploadedBy || '', photo);
      uploadedPhotos += 1;
    }
    if (listCellHistoryPhotos(row.id).length >= Math.min(photos.length, 3)) {
      db.prepare("UPDATE cell_work_history SET photos_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      clearedHistories += 1;
    }
  } catch (error) {
    issues.push({ historyId: row.id, message: error instanceof Error ? error.message : String(error) });
  }
}

const remaining = Number((db.prepare("SELECT COUNT(*) AS count FROM cell_work_history WHERE photos_json IS NOT NULL AND photos_json<>'[]'").get() as { count: number }).count);
console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN',
  batchSize,
  scannedHistories: rows.length,
  activeHistories,
  deletedHistories,
  legacyPhotos,
  uploadedPhotos,
  clearedHistories,
  remainingHistories: remaining,
  issues,
}, null, 2));

if (issues.length) process.exitCode = 1;
db.close();
