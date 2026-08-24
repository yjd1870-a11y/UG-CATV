import fs from 'node:fs';
import path from 'node:path';
import { db, initializeDatabase } from '../backend/db';
import { env } from '../backend/env';
import { deleteR2Prefix, usesR2Storage } from '../backend/object-storage';

const execute = process.argv.includes('--execute');
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'DELETE-STRAIGHT-MAP-V2';
const legacyPrefixes = ['line-diagrams/sources/', 'line-diagrams/artifacts/'] as const;
const localTargets = ['sources', 'artifacts'].map((name) => path.resolve(env.privateStoragePath, 'straight-maps', name));
const root = path.resolve(env.privateStoragePath, 'straight-maps');

await initializeDatabase();

const counts = {
  versions: Number((db.prepare("SELECT COUNT(*) AS count FROM map_versions WHERE COALESCE(render_mode, '') <> 'pdf-viewport-v3'").get() as { count: number }).count),
  jobs: Number((db.prepare("SELECT COUNT(*) AS count FROM straight_map_jobs WHERE source_key LIKE 'line-diagrams/sources/%'").get() as { count: number }).count),
  artifacts: Number((db.prepare("SELECT COUNT(*) AS count FROM straight_map_artifact_sets WHERE r2_prefix LIKE 'line-diagrams/artifacts/%'").get() as { count: number }).count),
};
console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', counts, legacyPrefixes, localTargets }, null, 2));

if (!execute) {
  console.log(`실제 삭제: npm run straight-map:cleanup-v2 -- --execute --confirm=${requiredConfirmation}`);
  process.exit(0);
}
if (confirmation !== requiredConfirmation) throw new Error(`삭제 확인 문자열이 필요합니다: --confirm=${requiredConfirmation}`);
for (const target of localTargets) {
  if (!target.startsWith(root + path.sep)) throw new Error(`보호 경계를 벗어난 삭제 대상입니다: ${target}`);
}

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare("DELETE FROM map_versions WHERE COALESCE(render_mode, '') <> 'pdf-viewport-v3'").run();
  db.prepare('DELETE FROM straight_maps WHERE map_id NOT IN (SELECT DISTINCT map_id FROM map_versions)').run();
  db.prepare("DELETE FROM straight_map_jobs WHERE source_key LIKE 'line-diagrams/sources/%'").run();
  db.prepare("DELETE FROM straight_map_artifact_sets WHERE r2_prefix LIKE 'line-diagrams/artifacts/%'").run();
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }

for (const target of localTargets) fs.rmSync(target, { recursive: true, force: true });
if (usesR2Storage) for (const prefix of legacyPrefixes) await deleteR2Prefix(prefix);
console.log('직선도 v2 DB 행과 sources/artifacts prefix 삭제를 완료했습니다. v3 및 비직선도 데이터는 유지했습니다.');
