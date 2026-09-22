import sharp from 'sharp';
import { db, initializeDatabase } from '../backend/db';
import { addCellHistoryPhotoFromDataUrl, listCellHistoryPhotos } from '../backend/cell-history-photo-service';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const backupConfirmed = args.has('--backup-confirmed');
const batchArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = Math.min(500, Math.max(1, Number(batchArg?.split('=')[1] || 50)));

const describeLegacyPhoto = (dataUrl: string) => {
  const declared = /^data:([^;,]+)/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (declared) return `declared=${declared}`;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(dataUrl)?.[1]?.toLowerCase();
  return scheme ? `scheme=${scheme}` : 'source=relative-or-unknown';
};

const normalizeLegacyPhotoDataUrl = async (dataUrl: string) => {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) return dataUrl;
  const declaredMime = match[1].toLowerCase();
  let buffer: Buffer;
  try {
    buffer = match[2]
      ? Buffer.from(match[3].replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  } catch {
    return dataUrl;
  }
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return dataUrl;
  const mimeType = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    ? 'image/jpeg'
    : buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? 'image/png'
      : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
        ? 'image/webp'
        : '';
  if (mimeType) return `data:${mimeType};base64,${buffer.toString('base64')}`;
  if (declaredMime === 'image/svg+xml') {
    const svg = buffer.toString('utf8');
    if (/<script\b|<!doctype\b|<!entity\b|<image\b|(?:xlink:)?href\s*=|url\s*\(/i.test(svg)) return dataUrl;
  }
  try {
    const converted = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${converted.toString('base64')}`;
  } catch {
    return dataUrl;
  }
};

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
      try {
        const normalized = await normalizeLegacyPhotoDataUrl(photo);
        await addCellHistoryPhotoFromDataUrl(row.id, row.cellId, row.uploadedBy || '', normalized);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} (${describeLegacyPhoto(photo)})`);
      }
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
