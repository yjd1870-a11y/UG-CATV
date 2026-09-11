import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  WORK_TRANSFER_REGION_NAMES,
  workTransferRegionParams,
  workTransferRegionPlaceholders,
} from '../work-transfer-policy';

export const createDatabaseMigrations = (db: DatabaseSync) => {
  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  const migrateFloorPlansForMultipleDrawings = () => {
    const columns = db.prepare('PRAGMA table_info(catv_floor_plans)').all() as Array<{ name: string }>;
    if (columns.some((entry) => entry.name === 'plan_order')) return;

    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE catv_floor_plans_new (
          id TEXT PRIMARY KEY,
          station_name TEXT NOT NULL,
          station_key TEXT NOT NULL,
          plan_order INTEGER NOT NULL DEFAULT 1 CHECK (plan_order BETWEEN 1 AND 3),
          file_name TEXT NOT NULL,
          image_url TEXT,
          object_key TEXT,
          width INTEGER,
          height INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(station_key, plan_order)
        );
        INSERT INTO catv_floor_plans_new (
          id, station_name, station_key, plan_order, file_name, image_url, object_key,
          width, height, created_at, updated_at
        )
        SELECT id, station_name, station_key, 1, file_name, image_url, object_key,
               width, height, created_at, updated_at
          FROM catv_floor_plans;
        DROP TABLE catv_floor_plans;
        ALTER TABLE catv_floor_plans_new RENAME TO catv_floor_plans;
        CREATE INDEX idx_catv_floor_plans_station ON catv_floor_plans(station_name, plan_order);
        COMMIT;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  };

  const syncRegionAssignments = () => {
    const departments = db.prepare(`
      SELECT DISTINCT department FROM users
       WHERE department <> '' AND deleted_at IS NULL ORDER BY department
    `).all() as Array<{ department: string }>;
    const insertRegion = db.prepare(`
      INSERT INTO regions (id, region_name, sort_order)
      VALUES (?, ?, ?)
      ON CONFLICT(region_name) DO NOTHING
    `);
    WORK_TRANSFER_REGION_NAMES.forEach((regionName, index) => insertRegion.run(randomUUID(), regionName, index + 1));
    db.prepare(`UPDATE regions SET active = 1 WHERE region_name IN (${workTransferRegionPlaceholders})`)
      .run(...workTransferRegionParams);
    departments.forEach((entry, index) => insertRegion.run(randomUUID(), entry.department, index + 101));
    const cellRegions = db.prepare(`
      SELECT DISTINCT region FROM cells
       WHERE region <> '' ORDER BY region
    `).all() as Array<{ region: string }>;
    cellRegions.forEach((entry, index) => insertRegion.run(randomUUID(), entry.region, departments.length + index + 201));
    db.prepare(`
      UPDATE users
         SET region_id = (SELECT id FROM regions WHERE region_name = users.department)
       WHERE region_id IS NULL OR region_id = ''
    `).run();
    const demoRegionAssignments: Array<[string, string]> = [
      ['user-1', '평택안성'],
      ['user-2', '평택안성'],
      ['user-3', '용인'],
      ['user-4', '평택안성'],
    ];
    const assignDemoRegion = db.prepare(`
      UPDATE users
         SET region_id = (SELECT id FROM regions WHERE region_name = ?)
       WHERE id = ?
         AND department LIKE '전송망%'
         AND (region_id IS NULL OR region_id = '' OR region_id NOT IN (
           SELECT id FROM regions WHERE region_name IN (${workTransferRegionPlaceholders})
         ))
    `);
    demoRegionAssignments.forEach(([userId, regionName]) => {
      assignDemoRegion.run(regionName, userId, ...workTransferRegionParams);
    });
    db.prepare(`
      UPDATE work_transfers
         SET region_id = (
           SELECT r.id
             FROM cells c
             JOIN regions r ON r.region_name = CASE
               WHEN c.region IN ('평택', '안성', '평택안성') THEN '평택안성'
               WHEN c.region IN ('용인', '수지') THEN '용인'
               WHEN c.region = '수원' THEN '수원'
               WHEN c.region IN ('오산', '화성', '오산화성') THEN '오산화성'
               ELSE c.region
             END
            WHERE c.id = work_transfers.cell_id
         )
       WHERE cell_id IS NOT NULL
         AND (region_id IS NULL OR region_id = '' OR region_id NOT IN (
           SELECT id FROM regions WHERE region_name IN (${workTransferRegionPlaceholders})
         ))
    `).run(...workTransferRegionParams);
    db.prepare(`
      UPDATE work_transfers
         SET workflow_status = CASE status
           WHEN 'completed' THEN 'completed'
           WHEN 'working' THEN 'field_processed'
           WHEN 'transferred' THEN 'field_processed'
           ELSE 'registered'
         END,
         is_urgent = CASE WHEN priority = 'urgent' THEN 1 ELSE is_urgent END
       WHERE workflow_status IS NULL
          OR workflow_status = ''
          OR (workflow_status = 'registered' AND status IN ('working', 'transferred', 'completed'))
    `).run();
  };

  return { ensureColumn, migrateFloorPlansForMultipleDrawings, syncRegionAssignments };
};
