import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../backend/env';

const requestedTag = (process.env.PRESTART_DATABASE_BACKUP_TAG || '').trim();

if (!requestedTag) {
  console.log('[CATV] Pre-start database backup not requested.');
  process.exit(0);
}

const deployedCommit = (process.env.RENDER_GIT_COMMIT || '').trim();
if (deployedCommit && deployedCommit !== requestedTag) {
  console.log('[CATV] Pre-start database backup skipped for a different commit.');
  process.exit(0);
}

if (!fs.existsSync(env.databasePath)) {
  throw new Error(`Pre-start database backup failed: source database not found at ${env.databasePath}`);
}

const safeTag = requestedTag.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
if (!safeTag) {
  throw new Error('Pre-start database backup failed: invalid backup tag.');
}

const backupDirectory = path.join(path.dirname(env.databasePath), 'backups');
const backupPath = path.join(backupDirectory, `catv-predeploy-${safeTag}.sqlite`);
fs.mkdirSync(backupDirectory, { recursive: true });

if (!fs.existsSync(backupPath)) {
  const escapedBackupPath = backupPath.replace(/'/g, "''");
  const source = new DatabaseSync(env.databasePath);
  try {
    source.exec(`PRAGMA busy_timeout=15000; VACUUM INTO '${escapedBackupPath}'`);
  } finally {
    source.close();
  }
}

const backup = new DatabaseSync(backupPath, { readOnly: true });
try {
  const result = backup.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
  if (!result || Object.values(result)[0] !== 'ok') {
    throw new Error('integrity_check did not return ok.');
  }
} finally {
  backup.close();
}

const sizeBytes = fs.statSync(backupPath).size;
console.log(`[CATV] Pre-start database backup verified: ${backupPath} (${sizeBytes} bytes)`);
