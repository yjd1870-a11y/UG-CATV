import { db, initializeDatabase } from '../backend/db';
import { retryStraightMapJob } from '../backend/straight-map-jobs';

await initializeDatabase();
const requestedJobId = process.argv[2] || '';
const jobs = db.prepare(`
  SELECT id FROM straight_map_jobs
   WHERE status IN ('FAILED', 'RETRY_WAIT', 'CANCELLED')
     AND attempt < max_attempts
     AND (? = '' OR id = ?)
   ORDER BY created_at
`).all(requestedJobId, requestedJobId) as Array<{ id: string }>;

console.log(`[STRAIGHT_MAP_RETRY] ${jobs.length}개 Job을 사무실 렌더러 대기열로 되돌립니다.`);
for (const job of jobs) console.log(retryStraightMapJob(job.id));
