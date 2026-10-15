import type { DatabaseSync } from 'node:sqlite';

/** Additive, idempotent migration. No models or media are seeded. */
export const migrateManualSchema = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS manual_models (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES manual_categories(id),
      name TEXT NOT NULL, manufacturer TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '', tips TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_model_name ON manual_models(category_id, name, manufacturer) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS manual_assets (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES manual_models(id),
      kind TEXT NOT NULL CHECK(kind IN ('video','photo','pdf','thumbnail')),
      title TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
      object_key TEXT NOT NULL UNIQUE, poster_id TEXT REFERENCES manual_assets(id),
      status TEXT NOT NULL CHECK(status IN ('pending','uploading','ready','deleted')),
      uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL, purged_at TEXT, purge_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_manual_assets_model ON manual_assets(model_id, status, kind);
  `);
  if (!(db.prepare('PRAGMA table_info(manual_models)').all() as { name: string }[]).some((column) => column.name === 'image_asset_id')) {
    db.exec('ALTER TABLE manual_models ADD COLUMN image_asset_id TEXT REFERENCES manual_assets(id)');
  }
  if (!(db.prepare('PRAGMA table_info(manual_assets)').all() as { name: string }[]).some((column) => column.name === 'purpose')) {
    db.exec("ALTER TABLE manual_assets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'manual' CHECK(purpose IN ('manual','model-cover'))");
    // Previously selected list photos become covers without copying or removing their files.
    db.exec("UPDATE manual_assets SET purpose = 'model-cover' WHERE kind = 'photo' AND id IN (SELECT image_asset_id FROM manual_models WHERE image_asset_id IS NOT NULL)");
  }
  const insert = db.prepare('INSERT INTO manual_categories (id, name, description) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const categories = [
    ['rf-meter', 'RF 측정기', '신호 측정 · 결과 확인'], ['otdr', 'OTDR', '광선로 측정 · 결과 판독'],
    ['fusion-splicer', '광융착기', '광섬유 접속 작업'], ['optical-meter', '광파워미터', '광레벨 측정'],
  ];
  db.exec('BEGIN IMMEDIATE');
  try { categories.forEach((category) => insert.run(...category)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};
