import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, initializeDatabase } from '../backend/db';
import { env } from '../backend/env';

await initializeDatabase();
const rows = db.prepare(`
  SELECT v.id AS versionId, v.map_id AS mapId, v.map_name AS mapName, v.version,
         v.rendered_width AS renderedWidth, v.rendered_height AS renderedHeight,
         o.shape_id AS shapeId, o.original_text AS label, o.x_ratio AS xRatio, o.y_ratio AS yRatio
    FROM map_versions v LEFT JOIN map_objects o ON o.version_id = v.id
   WHERE v.status = 'ACTIVE'
   ORDER BY v.map_id, o.shape_id, o.original_text
`).all();
const payload = { createdAt: new Date().toISOString(), activeVersionCount: new Set(rows.map((row) => String((row as Record<string, unknown>).versionId))).size, rows };
const json = JSON.stringify(payload, null, 2);
const hash = createHash('sha256').update(json).digest('hex');
const outputDirectory = path.join(path.dirname(env.databasePath), 'backups');
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `straight-map-coordinate-baseline-${hash.slice(0, 12)}.json`);
fs.writeFileSync(outputPath, json, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ outputPath, sha256: hash, rowCount: rows.length }));
