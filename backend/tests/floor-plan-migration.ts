import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catv-floor-plan-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
process.env.DATABASE_PATH = databasePath;
process.env.PRIVATE_STORAGE_PATH = path.join(root, 'storage');

const legacy = new DatabaseSync(databasePath);
legacy.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE catv_floor_plans (
    id TEXT PRIMARY KEY,
    station_name TEXT NOT NULL,
    station_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    image_url TEXT,
    object_key TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_catv_floor_plans_station ON catv_floor_plans(station_name);
  CREATE TABLE catv_floor_plan_coordinates (
    id TEXT PRIMARY KEY,
    floor_plan_id TEXT NOT NULL REFERENCES catv_floor_plans(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    node_name TEXT NOT NULL DEFAULT '',
    rack_name TEXT NOT NULL DEFAULT '',
    equipment_type TEXT NOT NULL DEFAULT '',
    x_ratio REAL NOT NULL CHECK (x_ratio >= 0 AND x_ratio <= 1),
    y_ratio REAL NOT NULL CHECK (y_ratio >= 0 AND y_ratio <= 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO catv_floor_plans (id, station_name, station_key, file_name)
  VALUES ('legacy-plan', '오산국사', '오산', 'legacy.png');
  INSERT INTO catv_floor_plan_coordinates (id, floor_plan_id, label, rack_name, x_ratio, y_ratio)
  VALUES ('legacy-coordinate', 'legacy-plan', 'Rack 7', 'Rack 7', 0.25, 0.75);
`);
legacy.close();

const { db, initializeDatabase } = await import('../db');
await initializeDatabase();

const migrated = db.prepare('SELECT plan_order AS planOrder FROM catv_floor_plans WHERE id = ?')
  .get('legacy-plan') as { planOrder: number } | undefined;
assert.equal(migrated?.planOrder, 1);
const coordinate = db.prepare('SELECT rack_name AS rackName FROM catv_floor_plan_coordinates WHERE floor_plan_id = ?')
  .get('legacy-plan') as { rackName: string } | undefined;
assert.equal(coordinate?.rackName, 'Rack 7');

db.prepare(`INSERT INTO catv_floor_plans (id, station_name, station_key, plan_order, file_name) VALUES (?, ?, ?, ?, ?)`)
  .run('plan-2', '오산국사', '오산', 2, 'plan-2.png');
db.prepare(`INSERT INTO catv_floor_plans (id, station_name, station_key, plan_order, file_name) VALUES (?, ?, ?, ?, ?)`)
  .run('plan-3', '오산국사', '오산', 3, 'plan-3.png');
assert.throws(() => db.prepare(`INSERT INTO catv_floor_plans (id, station_name, station_key, plan_order, file_name) VALUES (?, ?, ?, ?, ?)`)
  .run('plan-4', '오산국사', '오산', 4, 'plan-4.png'));

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('Floor plan migration test passed: legacy drawing and coordinates preserved with plan_order 1.');
