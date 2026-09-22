import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env, projectRoot } from '../backend/env';

const mode = (process.env.CELL_HISTORY_PHOTO_MIGRATION_MODE || '').trim().toLowerCase();
const requestedRunId = (process.env.CELL_HISTORY_PHOTO_MIGRATION_RUN_ID || '').trim();

if (mode !== 'apply') {
  console.log('[CATV] One-time CELL history photo migration is disabled.');
  process.exit(0);
}

const runId = requestedRunId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
if (!runId || runId !== requestedRunId) {
  throw new Error('CELL history photo migration requires a safe CELL_HISTORY_PHOTO_MIGRATION_RUN_ID.');
}

const markerDirectory = path.join(path.dirname(env.databasePath), 'migration-markers');
const markerPath = path.join(markerDirectory, `${runId}.json`);
if (fs.existsSync(markerPath)) {
  console.log(`[CATV] CELL history photo migration ${runId} already completed; skipping.`);
  process.exit(0);
}

const backupDirectory = path.join(path.dirname(env.databasePath), 'backups');
const backupFiles = fs.existsSync(backupDirectory)
  ? fs.readdirSync(backupDirectory)
      .filter((name) => /^catv-predeploy-[a-zA-Z0-9_-]+\.sqlite$/.test(name))
      .map((name) => path.join(backupDirectory, name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  : [];

const validBackups: string[] = [];
const invalidBackups: string[] = [];
for (const candidate of backupFiles) {
  try {
    const backup = new DatabaseSync(candidate, { readOnly: true });
    try {
      const result = backup.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
      if (result && Object.values(result)[0] === 'ok') validBackups.push(candidate);
      else invalidBackups.push(candidate);
    } finally {
      backup.close();
    }
  } catch {
    invalidBackups.push(candidate);
  }
}

const backupPath = validBackups[0];
if (!backupPath) {
  throw new Error('CELL history photo migration refused: no pre-deploy SQLite backup was found.');
}

const deployedCommit = (process.env.RENDER_GIT_COMMIT || '').replace(/[^a-fA-F0-9]/g, '');
const failedCurrentBackup = deployedCommit
  ? path.join(backupDirectory, `catv-predeploy-${deployedCommit}.sqlite`)
  : '';
if (failedCurrentBackup && invalidBackups.includes(failedCurrentBackup)) {
  fs.unlinkSync(failedCurrentBackup);
  console.log(`[CATV] Removed incomplete backup left by a failed VACUUM INTO: ${failedCurrentBackup}`);
}

const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const migrationScript = path.join(projectRoot, 'scripts', 'migrate-cell-history-photos.ts');
const runMigration = (args: string[]) => {
  const result = spawnSync(process.execPath, [tsxCli, migrationScript, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`CELL history photo migration command failed with exit code ${result.status ?? 'unknown'}.`);
  }
};

console.log(`[CATV] CELL history photo migration ${runId}: verified backup ${backupPath}`);
runMigration(['--batch-size=500']);
runMigration(['--apply', '--backup-confirmed', '--batch-size=500']);

fs.mkdirSync(markerDirectory, { recursive: true });
fs.writeFileSync(markerPath, JSON.stringify({
  runId,
  completedAt: new Date().toISOString(),
  backupPath,
}, null, 2));
console.log(`[CATV] CELL history photo migration ${runId}: completed and marked at ${markerPath}`);
