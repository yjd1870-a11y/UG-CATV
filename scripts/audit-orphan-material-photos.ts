import { db, initializeDatabase } from '../backend/db';
import { materialPhotoOrphanReport, purgeMaterialTransactionPhotos } from '../backend/material-photo-retention';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
if (apply && !args.has('--backup-confirmed')) {
  throw new Error('실제 정리 전 SQLite와 R2 백업을 완료한 뒤 --backup-confirmed 옵션을 함께 지정하세요.');
}

await initializeDatabase();
const before = materialPhotoOrphanReport();
let purgedTransactions = 0;
const failures: Array<{ transactionId: string; message: string }> = [];

if (apply) {
  const transactionIds = [...new Set((before.rows as Array<{ transactionId: string }>).map((row) => row.transactionId).filter(Boolean))];
  for (const transactionId of transactionIds) {
    try {
      await purgeMaterialTransactionPhotos(transactionId, null, '고아/취소 자재사진 운영 정리');
      purgedTransactions += 1;
    } catch (error) {
      failures.push({ transactionId, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN',
  candidates: before.count,
  purgedTransactions,
  failures,
  remaining: materialPhotoOrphanReport().count,
  rows: apply ? undefined : before.rows,
}, null, 2));
if (failures.length) process.exitCode = 1;
db.close();
