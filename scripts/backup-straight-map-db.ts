import fs from 'node:fs';
import path from 'node:path';
import { db, initializeDatabase } from '../backend/db';
import { env } from '../backend/env';

await initializeDatabase();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = path.join(path.dirname(env.databasePath), 'backups');
fs.mkdirSync(backupDirectory, { recursive: true });
const backupPath = path.join(backupDirectory, `catv-before-straight-map-v2-${stamp}.sqlite`);
const escaped = backupPath.replace(/'/g, "''");
db.exec(`PRAGMA wal_checkpoint(FULL); VACUUM INTO '${escaped}'`);
console.log(backupPath);
