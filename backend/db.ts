import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  INITIAL_DAILY_WORK_RECORDS,
  INITIAL_MATERIAL_USAGE,
  MOCK_CELLS,
  MOCK_USERS,
  MOCK_WORK_TRANSFERS,
} from '../src/data/mockData';
import { MATERIAL_CATEGORIES } from '../src/types';
import { env } from './env';
import { hashPassword, isValidPassword } from './security/password';
import { normalizeStationName, textValue } from './catv';
import { saveFloorPlanDataUrl } from './floor-plan-storage';
import { buildB2CSearchValue } from './b2c-search';
import { normalizeStraightMapCompactText } from './straight-map-search';

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

export const db = new DatabaseSync(env.databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT '',
  employee_number TEXT UNIQUE,
  department TEXT NOT NULL,
  phone TEXT,
  company TEXT NOT NULL DEFAULT '유지텔레컴',
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'worker')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  password_updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(username, ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_date ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  site_name TEXT NOT NULL,
  site_code TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  floor TEXT,
  rack_info TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS cells (
  id TEXT PRIMARY KEY,
  cell_name TEXT NOT NULL,
  cell_code TEXT NOT NULL UNIQUE,
  node_name TEXT NOT NULL,
  site_id TEXT REFERENCES sites(id) ON DELETE RESTRICT,
  line_code TEXT,
  address TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '정상',
  memo TEXT,
  responsible_team TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cells_name ON cells(cell_name);
CREATE INDEX IF NOT EXISTS idx_cells_code ON cells(cell_code);
CREATE INDEX IF NOT EXISTS idx_cells_node ON cells(node_name);
CREATE INDEX IF NOT EXISTS idx_cells_site ON cells(site_id);
CREATE INDEX IF NOT EXISTS idx_cells_region ON cells(region);

CREATE TABLE IF NOT EXISTS transmission_lines (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE RESTRICT,
  line_number TEXT NOT NULL,
  transmitter TEXT,
  receiver TEXT,
  start_site TEXT,
  end_site TEXT,
  equipment_info TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transmission_lines_cell ON transmission_lines(cell_id);

CREATE TABLE IF NOT EXISTS field_photos (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE RESTRICT,
  work_id TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  memo TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_field_photos_cell ON field_photos(cell_id);

CREATE TABLE IF NOT EXISTS cell_work_history (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE RESTRICT,
  title TEXT,
  work_type TEXT NOT NULL,
  work_date TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cell_work_history_cell ON cell_work_history(cell_id);

CREATE TABLE IF NOT EXISTS work_transfers (
  id TEXT PRIMARY KEY,
  cell_id TEXT REFERENCES cells(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  from_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'working', 'transferred', 'completed')),
  transfer_date TEXT NOT NULL,
  due_date TEXT,
  completed_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_transfers_cell ON work_transfers(cell_id);
CREATE INDEX IF NOT EXISTS idx_work_transfers_status ON work_transfers(status);
CREATE INDEX IF NOT EXISTS idx_work_transfers_to_user ON work_transfers(to_user_id);

CREATE TABLE IF NOT EXISTS work_transfer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT NOT NULL REFERENCES work_transfers(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_transfer_logs_transfer ON work_transfer_logs(transfer_id);

CREATE TABLE IF NOT EXISTS daily_work (
  id TEXT PRIMARY KEY,
  work_date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cell_id TEXT REFERENCES cells(id) ON DELETE RESTRICT,
  work_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('planned', 'working', 'completed', 'cancelled')),
  start_time TEXT,
  end_time TEXT,
  memo TEXT,
  counts_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(work_date, user_id, title)
);
CREATE INDEX IF NOT EXISTS idx_daily_work_date ON daily_work(work_date);
CREATE INDEX IF NOT EXISTS idx_daily_work_user ON daily_work(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_work_cell ON daily_work(cell_id);

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  region_name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_work_items (
  id TEXT PRIMARY KEY,
  daily_work_id TEXT NOT NULL REFERENCES daily_work(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES work_categories(id) ON DELETE RESTRICT,
  work_count INTEGER NOT NULL DEFAULT 0 CHECK (work_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(daily_work_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_work_items_category ON daily_work_items(category_id);
CREATE INDEX IF NOT EXISTS idx_daily_work_items_work_category ON daily_work_items(daily_work_id, category_id);

CREATE TABLE IF NOT EXISTS daily_work_history (
  id TEXT PRIMARY KEY,
  daily_work_id TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_type TEXT NOT NULL CHECK (change_type IN ('CREATE', 'UPDATE', 'DELETE')),
  before_data TEXT,
  after_data TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_daily_work_history_work ON daily_work_history(daily_work_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_work_history_actor ON daily_work_history(changed_by, changed_at DESC);

CREATE TABLE IF NOT EXISTS home_notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_home_notices_order ON home_notices(active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  material_code TEXT NOT NULL UNIQUE,
  material_name TEXT NOT NULL UNIQUE,
  specification TEXT,
  unit TEXT NOT NULL,
  stock_quantity REAL NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  minimum_stock REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(material_name);

CREATE TABLE IF NOT EXISTS material_usage (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cell_id TEXT REFERENCES cells(id) ON DELETE RESTRICT,
  work_id TEXT REFERENCES daily_work(id) ON DELETE SET NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  usage_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  specification TEXT,
  unit TEXT NOT NULL,
  work_details TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_material_usage_material ON material_usage(material_id);
CREATE INDEX IF NOT EXISTS idx_material_usage_user ON material_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_material_usage_cell ON material_usage(cell_id);
CREATE INDEX IF NOT EXISTS idx_material_usage_date ON material_usage(usage_date);

CREATE TABLE IF NOT EXISTS db_upload_history (
  id TEXT PRIMARY KEY,
  db_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  message TEXT
);
CREATE INDEX IF NOT EXISTS idx_db_upload_history_date ON db_upload_history(uploaded_at DESC);

CREATE TABLE IF NOT EXISTS admin_db_assets (
  id TEXT PRIMARY KEY,
  db_type TEXT NOT NULL CHECK (db_type IN ('floor_plan', 'b2c')),
  station_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  coordinates_json TEXT NOT NULL DEFAULT '{}',
  data_json TEXT NOT NULL DEFAULT '[]',
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_db_assets_type ON admin_db_assets(db_type, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS catv_cells (
  id TEXT PRIMARY KEY,
  key_number TEXT NOT NULL,
  cell_name TEXT NOT NULL,
  station_name TEXT NOT NULL,
  station_address TEXT NOT NULL DEFAULT '',
  otx_main TEXT NOT NULL DEFAULT '',
  otx_line TEXT NOT NULL DEFAULT '',
  orx_main TEXT NOT NULL DEFAULT '',
  orx_line TEXT NOT NULL DEFAULT '',
  backup_node TEXT NOT NULL DEFAULT '',
  backup_line TEXT NOT NULL DEFAULT '',
  otx_rack TEXT NOT NULL DEFAULT '',
  otx_shelf TEXT NOT NULL DEFAULT '',
  otx_port TEXT NOT NULL DEFAULT '',
  otx_model TEXT NOT NULL DEFAULT '',
  orx_rack TEXT NOT NULL DEFAULT '',
  orx_shelf TEXT NOT NULL DEFAULT '',
  orx_port TEXT NOT NULL DEFAULT '',
  orx_model TEXT NOT NULL DEFAULT '',
  onu_location TEXT NOT NULL DEFAULT '',
  onu_maker TEXT NOT NULL DEFAULT '',
  onu_model TEXT NOT NULL DEFAULT '',
  onu_split TEXT NOT NULL DEFAULT '',
  onu_cell_config TEXT NOT NULL DEFAULT '',
  ups_location TEXT NOT NULL DEFAULT '',
  ups_maker TEXT NOT NULL DEFAULT '',
  ups_model TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catv_cells_key_number ON catv_cells(key_number);
CREATE INDEX IF NOT EXISTS idx_catv_cells_cell_name ON catv_cells(cell_name);
CREATE INDEX IF NOT EXISTS idx_catv_cells_station_name ON catv_cells(station_name);

CREATE TABLE IF NOT EXISTS catv_b2c_lines (
  id TEXT PRIMARY KEY,
  station_name TEXT NOT NULL,
  station_key TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  b2c_name TEXT NOT NULL DEFAULT '',
  node TEXT NOT NULL DEFAULT '',
  line TEXT NOT NULL DEFAULT '',
  core TEXT NOT NULL DEFAULT '',
  service_line_number TEXT NOT NULL DEFAULT '',
  service_category TEXT NOT NULL DEFAULT '',
  service_type TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  search_values TEXT NOT NULL DEFAULT '[]',
  normalized_search TEXT NOT NULL DEFAULT '',
  sheet_name TEXT NOT NULL DEFAULT '',
  row_number INTEGER,
  source_file TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_catv_b2c_station_name ON catv_b2c_lines(station_name);
CREATE INDEX IF NOT EXISTS idx_catv_b2c_service_name ON catv_b2c_lines(service_name);
CREATE INDEX IF NOT EXISTS idx_catv_b2c_name ON catv_b2c_lines(b2c_name);
CREATE INDEX IF NOT EXISTS idx_catv_b2c_node ON catv_b2c_lines(node);

CREATE TABLE IF NOT EXISTS map_versions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  map_name TEXT NOT NULL,
  map_key TEXT NOT NULL,
  station_key TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  original_file_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  sheet_name TEXT NOT NULL DEFAULT '',
  map_width INTEGER NOT NULL,
  map_height INTEGER NOT NULL,
  rendered_width INTEGER,
  rendered_height INTEGER,
  tile_size INTEGER NOT NULL DEFAULT 256,
  max_zoom INTEGER,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT,
  UNIQUE(map_id, version)
);
CREATE INDEX IF NOT EXISTS idx_map_versions_map_status ON map_versions(map_id, status, version DESC);
CREATE INDEX IF NOT EXISTS idx_map_versions_key_status ON map_versions(map_key, status, version DESC);

CREATE TABLE IF NOT EXISTS map_objects (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES map_versions(id) ON DELETE CASCADE,
  shape_id TEXT NOT NULL,
  shape_name TEXT NOT NULL DEFAULT '',
  object_type TEXT NOT NULL,
  original_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  compact_text TEXT NOT NULL DEFAULT '',
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  center_x INTEGER NOT NULL,
  center_y INTEGER NOT NULL,
  x_ratio REAL NOT NULL CHECK (x_ratio >= 0 AND x_ratio <= 1),
  y_ratio REAL NOT NULL CHECK (y_ratio >= 0 AND y_ratio <= 1),
  group_id TEXT,
  rotation REAL NOT NULL DEFAULT 0,
  shape_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(version_id, shape_id, original_text)
);
CREATE INDEX IF NOT EXISTS idx_map_objects_normalized_text ON map_objects(normalized_text);
CREATE INDEX IF NOT EXISTS idx_map_objects_map_id ON map_objects(map_id);
CREATE INDEX IF NOT EXISTS idx_map_objects_version_id ON map_objects(version_id);
CREATE INDEX IF NOT EXISTS idx_map_objects_search ON map_objects(normalized_text, map_id, version_id);

CREATE TABLE IF NOT EXISTS catv_floor_plans (
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
CREATE INDEX IF NOT EXISTS idx_catv_floor_plans_station ON catv_floor_plans(station_name);

CREATE TABLE IF NOT EXISTS catv_floor_plan_coordinates (
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
CREATE INDEX IF NOT EXISTS idx_catv_floor_coordinates_plan ON catv_floor_plan_coordinates(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_catv_floor_coordinates_node ON catv_floor_plan_coordinates(node_name);
CREATE INDEX IF NOT EXISTS idx_catv_floor_coordinates_rack ON catv_floor_plan_coordinates(rack_name);
`;

const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

export const createSchema = () => {
  db.exec(schema);
  ensureColumn('users', 'zone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'region_id', 'TEXT');
  ensureColumn('users', 'access_role', 'TEXT');
  ensureColumn('users', 'password_updated_at', 'TEXT');
  ensureColumn('daily_work', 'region_id', 'TEXT');
  ensureColumn('daily_work', 'created_by', 'TEXT');
  ensureColumn('daily_work', 'updated_by', 'TEXT');
  ensureColumn('catv_b2c_lines', 'station_key', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'core', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'service_line_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'service_category', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'service_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'normalized_search', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'sheet_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('catv_b2c_lines', 'row_number', 'INTEGER');
  ensureColumn('map_versions', 'station_key', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('map_versions', 'reuse_version_id', 'TEXT');
  ensureColumn('map_objects', 'compact_text', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_catv_b2c_station_key ON catv_b2c_lines(station_key);
    CREATE INDEX IF NOT EXISTS idx_catv_b2c_normalized_search ON catv_b2c_lines(normalized_search);
    CREATE INDEX IF NOT EXISTS idx_map_versions_station_sheet ON map_versions(station_key, map_key, status, version DESC);
    CREATE INDEX IF NOT EXISTS idx_map_objects_compact_text ON map_objects(compact_text);
    CREATE INDEX IF NOT EXISTS idx_daily_work_region ON daily_work(region_id);
    CREATE INDEX IF NOT EXISTS idx_daily_work_date_user ON daily_work(work_date, user_id);
    CREATE INDEX IF NOT EXISTS idx_daily_work_date_region ON daily_work(work_date, region_id);
  `);
  db.prepare(`
    UPDATE users
       SET access_role = CASE role
         WHEN 'admin' THEN 'admin'
         WHEN 'manager' THEN 'team_leader'
         ELSE 'manager'
       END
     WHERE access_role IS NULL OR access_role = ''
  `).run();

  const noticeCount = Number((db.prepare('SELECT COUNT(*) AS count FROM home_notices').get() as { count: number }).count);
  if (noticeCount === 0) {
    const insertNotice = db.prepare(`
      INSERT INTO home_notices (id, title, content, sort_order)
      VALUES (?, ?, ?, ?)
    `);
    insertNotice.run('notice-safety-1', '전주 승주 작업 안전', '전주 승주 작업 시 안전모 및 안전그네를 반드시 착용해 주세요.', 1);
    insertNotice.run('notice-safety-2', '동축 케이블 방수 마감', '동축 케이블 탈피 작업 후 방수 수축튜브 마감을 반드시 확인해 주세요.', 2);
    insertNotice.run('notice-safety-3', '상향 노이즈 측정 주의', '상향 노이즈 측정 시 고역통과필터(HPF)가 정상 삽입되었는지 확인해 주세요.', 3);
  }

  const categorySeeds = [
    ['WORK01', '장애처리'],
    ['WORK02', '불량셀'],
    ['WORK03', '노이즈'],
    ['WORK04', 'SWING'],
    ['WORK05', '정기점검'],
    ['WORK06', '민원'],
    ['WORK07', '합동정비'],
    ['WORK08', '한전순시적출'],
    ['WORK09', '업무지원'],
    ['WORK10', '기타'],
  ] as const;
  const insertCategory = db.prepare(`
    INSERT INTO work_categories (id, code, category_name, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `);
  categorySeeds.forEach(([code, name], index) => insertCategory.run(`category-${code}`, code, name, index + 1));

  const departments = db.prepare(`
    SELECT DISTINCT department FROM users
     WHERE department <> '' AND deleted_at IS NULL ORDER BY department
  `).all() as Array<{ department: string }>;
  const insertRegion = db.prepare(`
    INSERT INTO regions (id, region_name, sort_order)
    VALUES (?, ?, ?)
    ON CONFLICT(region_name) DO NOTHING
  `);
  departments.forEach((entry, index) => insertRegion.run(`region-${index + 1}`, entry.department, index + 1));
  db.prepare(`
    UPDATE users
       SET region_id = (SELECT id FROM regions WHERE region_name = users.department)
     WHERE region_id IS NULL OR region_id = ''
  `).run();
  db.prepare(`
    UPDATE daily_work
       SET work_date = replace(work_date, '.', '-')
     WHERE work_date LIKE '____.__.__'
  `).run();
  db.prepare(`
    UPDATE daily_work
       SET region_id = (SELECT region_id FROM users WHERE users.id = daily_work.user_id),
           created_by = COALESCE(created_by, user_id),
           updated_by = COALESCE(updated_by, user_id)
     WHERE region_id IS NULL OR created_by IS NULL OR updated_by IS NULL
  `).run();

  const categoriesByName = new Map(
    (db.prepare('SELECT id, category_name FROM work_categories').all() as Array<{ id: string; category_name: string }>)
      .map((entry) => [entry.category_name, entry.id])
  );
  const legacyDailyRows = db.prepare(`
    SELECT id, counts_json FROM daily_work
     WHERE deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM daily_work_items i WHERE i.daily_work_id = daily_work.id)
  `).all() as Array<{ id: string; counts_json: string }>;
  const insertItem = db.prepare(`
    INSERT INTO daily_work_items (id, daily_work_id, category_id, work_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(daily_work_id, category_id) DO UPDATE SET work_count = excluded.work_count
  `);
  for (const row of legacyDailyRows) {
    let counts: Record<string, unknown> = {};
    try { counts = JSON.parse(row.counts_json || '{}'); } catch { counts = {}; }
    for (const [categoryName, categoryId] of categoriesByName) {
      const value = Number(counts[categoryName] || 0);
      insertItem.run(`${row.id}-${categoryId}`, row.id, categoryId, Number.isInteger(value) && value >= 0 ? value : 0);
    }
  }
  const b2cRows = db.prepare(`SELECT id, station_name, service_name, b2c_name, memo, search_values FROM catv_b2c_lines WHERE station_key = '' OR normalized_search = ''`).all() as Array<Record<string, unknown>>;
  const updateB2CSearch = db.prepare('UPDATE catv_b2c_lines SET station_key = ?, normalized_search = ? WHERE id = ?');
  for (const row of b2cRows) {
    let values: unknown[] = [];
    try { const parsed = JSON.parse(String(row.search_values || '[]')); if (Array.isArray(parsed)) values = parsed; } catch { values = []; }
    updateB2CSearch.run(normalizeStationName(row.station_name), buildB2CSearchValue(values.length ? values : [row.service_name, row.b2c_name, row.memo]), String(row.id));
  }
  db.prepare("UPDATE map_versions SET station_key = map_key WHERE station_key = ''").run();
  const mapObjectRows = db.prepare("SELECT id, normalized_text FROM map_objects WHERE compact_text = ''").all() as Array<{ id: string; normalized_text: string }>;
  const updateMapCompactText = db.prepare('UPDATE map_objects SET compact_text = ? WHERE id = ?');
  for (const row of mapObjectRows) updateMapCompactText.run(normalizeStraightMapCompactText(row.normalized_text), row.id);
};

const legacyDbRole = (role: string) => {
  if (role === 'admin') return 'admin';
  if (role === 'team_leader') return 'manager';
  return 'worker';
};

export const toDbTransferStatus = (status: string) => {
  const mapping: Record<string, string> = {
    대기: 'pending',
    작업중: 'working',
    업무이관: 'transferred',
    완료: 'completed',
  };
  return mapping[status] || status;
};

export const seedDatabase = async () => {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (countRow.count > 0) return;

  if (env.isProduction) {
    if (!env.bootstrapAdminUsername || !env.bootstrapAdminPassword) {
      throw new Error('An empty production database requires BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD.');
    }
    if (!isValidPassword(env.bootstrapAdminPassword)) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters and include a letter, a number, and a symbol.');
    }
    const passwordHash = await hashPassword(env.bootstrapAdminPassword);
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, name, employee_number, department, company,
        role, access_role, status, password_updated_at
      ) VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'SYSTEM', 'admin', 'admin', 'active', CURRENT_TIMESTAMP)
    `).run(randomUUID(), env.bootstrapAdminUsername, passwordHash, env.bootstrapAdminName, env.bootstrapAdminUsername);
    return;
  }

  const defaultPasswordHash = await hashPassword('1234');
  db.exec('BEGIN IMMEDIATE');

  try {
    const insertUser = db.prepare(`
      INSERT INTO users (
        id, username, password_hash, name, employee_number, department, phone, company, role, access_role, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    for (const user of MOCK_USERS) {
      insertUser.run(user.id, user.id, defaultPasswordHash, user.name, user.id, user.team, user.phone, user.company, legacyDbRole(user.role), user.role);
    }

    const insertSite = db.prepare(`
      INSERT INTO sites (id, site_name, site_code, address, floor, rack_info, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCell = db.prepare(`
      INSERT INTO cells (
        id, cell_name, cell_code, node_name, site_id, line_code, address, region,
        status, memo, responsible_team, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLine = db.prepare(`
      INSERT INTO transmission_lines (
        id, cell_id, line_number, transmitter, receiver, start_site, end_site, equipment_info, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPhoto = db.prepare(`
      INSERT INTO field_photos (
        id, cell_id, file_name, file_url, file_type, uploaded_by, uploaded_at, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertHistory = db.prepare(`
      INSERT INTO cell_work_history (
        id, cell_id, title, work_type, work_date, worker_name, summary, status, photos_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [cellIndex, cell] of MOCK_CELLS.entries()) {
      const siteId = `site-${cellIndex + 1}`;
      const station = cell.stationDetails;
      insertSite.run(
        siteId,
        station?.stationName || `${cell.region}국사`,
        station?.descriptionCode || `SITE-${cellIndex + 1}`,
        station?.stationAddress || cell.address,
        cell.floorPlanData.rackNumber,
        JSON.stringify(cell.floorPlanData),
        cell.remarks
      );
      insertCell.run(
        cell.id,
        cell.cellName,
        cell.cellName,
        cell.opticalNode,
        siteId,
        cell.lineCode,
        cell.address,
        cell.region,
        cell.status,
        cell.remarks,
        cell.responsibleTeam,
        JSON.stringify(cell)
      );

      const lines = station?.lineInfoList?.length
        ? station.lineInfoList
        : [{ item: '주 선번', node: cell.opticalNode, lineNo: cell.lineCode }];
      lines.forEach((line, lineIndex) => {
        insertLine.run(
          `${cell.id}-line-${lineIndex + 1}`,
          cell.id,
          line.lineNo,
          cell.floorPlanData.transmitter,
          station?.transceiverList?.[lineIndex]?.model || cell.opticalNode,
          station?.stationName || cell.stationInfo,
          cell.address,
          JSON.stringify({ item: line.item, node: line.node }),
          cell.remarks
        );
      });

      cell.photos.forEach((photo) => {
        const uploader = MOCK_USERS.find((user) => user.name === photo.author)?.id || null;
        insertPhoto.run(
          photo.id,
          cell.id,
          photo.title,
          photo.url,
          photo.url.startsWith('data:') ? 'image/svg+xml' : 'image/jpeg',
          uploader,
          photo.date,
          JSON.stringify({ category: photo.category, description: photo.description })
        );
      });

      cell.history.forEach((history) => {
        insertHistory.run(
          history.id,
          cell.id,
          history.title || history.type,
          history.type,
          history.date,
          history.worker,
          history.summary,
          history.status || '완료',
          JSON.stringify(history.photos || [])
        );
      });
    }

    const insertTransfer = db.prepare(`
      INSERT INTO work_transfers (
        id, cell_id, title, description, from_user_id, to_user_id, priority, status,
        transfer_date, completed_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTransferLog = db.prepare(`
      INSERT INTO work_transfer_logs (
        transfer_id, author_user_id, author_name, from_status, to_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const transfer of MOCK_WORK_TRANSFERS) {
      const cell = MOCK_CELLS.find((item) => item.cellName === transfer.cellName);
      const requester = MOCK_USERS.find((user) => user.name === transfer.requesterName);
      const worker = MOCK_USERS.find((user) => user.name === transfer.workerName);
      insertTransfer.run(
        transfer.id,
        cell?.id || null,
        transfer.transferReason,
        transfer.requestDetails,
        requester?.id || 'user-4',
        worker?.id || null,
        transfer.transferReason.includes('긴급') ? 'urgent' : 'normal',
        toDbTransferStatus(transfer.status),
        transfer.requestDate,
        transfer.completedDate || null,
        JSON.stringify(transfer)
      );
      transfer.logs.forEach((log) => {
        const author = MOCK_USERS.find((user) => user.name === log.author);
        insertTransferLog.run(
          transfer.id,
          author?.id || null,
          log.author,
          log.fromStatus ? toDbTransferStatus(log.fromStatus) : null,
          toDbTransferStatus(log.toStatus),
          log.comment,
          log.timestamp
        );
      });
    }

    const insertDaily = db.prepare(`
      INSERT INTO daily_work (
        id, work_date, user_id, work_type, title, description, result, status, memo, counts_json, updated_at
      ) VALUES (?, ?, ?, '일일집계', '일일업무 집계', ?, ?, 'completed', ?, ?, ?)
    `);
    for (const record of INITIAL_DAILY_WORK_RECORDS) {
      const user = MOCK_USERS.find((item) => item.name === record.workerName) || MOCK_USERS[0];
      insertDaily.run(
        record.id,
        record.date,
        user.id,
        `${record.workerName} ${record.team} 작업 집계`,
        `총 ${Object.values(record.counts).reduce((total, count) => total + count, 0)}건`,
        record.memo || null,
        JSON.stringify(record.counts),
        record.updatedAt
      );
    }

    const insertMaterial = db.prepare(`
      INSERT INTO materials (
        id, material_code, material_name, specification, unit, stock_quantity, minimum_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    MATERIAL_CATEGORIES.forEach((name, index) => {
      insertMaterial.run(`material-${index + 1}`, `MAT-${String(index + 1).padStart(3, '0')}`, name, '표준 규격', 'EA', 10000, 50);
    });

    const insertUsage = db.prepare(`
      INSERT INTO material_usage (
        id, material_id, user_id, cell_id, quantity, usage_date, purpose,
        specification, unit, work_details, memo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const usage of INITIAL_MATERIAL_USAGE) {
      const materialIndex = MATERIAL_CATEGORIES.indexOf(usage.materialName);
      const user = MOCK_USERS.find((item) => item.name === usage.workerName) || MOCK_USERS[0];
      const cell = MOCK_CELLS.find((item) => item.cellName === usage.cellName);
      insertUsage.run(
        usage.id,
        `material-${Math.max(0, materialIndex) + 1}`,
        user.id,
        cell?.id || null,
        usage.quantity,
        usage.workDate,
        usage.purpose,
        usage.spec,
        usage.unit,
        usage.workDetails,
        usage.remarks || null,
        usage.createdAt
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const syncCatvCellsFromLegacy = () => {
  const rows = db.prepare(`
    SELECT c.id, c.cell_name, c.cell_code, c.node_name, c.line_code, c.address, c.memo,
           c.details_json, s.site_name, s.address AS site_address
      FROM cells c
      LEFT JOIN sites s ON s.id = c.site_id
     WHERE c.deleted_at IS NULL
  `).all() as Array<Record<string, unknown>>;
  const upsert = db.prepare(`
    INSERT INTO catv_cells (
      id, key_number, cell_name, station_name, station_address,
      otx_main, otx_line, orx_main, orx_line, backup_node, backup_line,
      otx_rack, otx_shelf, otx_port, otx_model,
      orx_rack, orx_shelf, orx_port, orx_model,
      onu_location, onu_maker, onu_model, onu_split, onu_cell_config,
      ups_location, ups_maker, ups_model, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_number) DO UPDATE SET
      id = excluded.id, cell_name = excluded.cell_name, station_name = excluded.station_name,
      station_address = excluded.station_address, otx_main = excluded.otx_main,
      otx_line = excluded.otx_line, orx_main = excluded.orx_main,
      orx_line = excluded.orx_line, backup_node = excluded.backup_node,
      backup_line = excluded.backup_line, otx_rack = excluded.otx_rack,
      otx_shelf = excluded.otx_shelf, otx_port = excluded.otx_port,
      otx_model = excluded.otx_model, orx_rack = excluded.orx_rack,
      orx_shelf = excluded.orx_shelf, orx_port = excluded.orx_port,
      orx_model = excluded.orx_model, onu_location = excluded.onu_location,
      onu_maker = excluded.onu_maker, onu_model = excluded.onu_model,
      onu_split = excluded.onu_split, onu_cell_config = excluded.onu_cell_config,
      ups_location = excluded.ups_location, ups_maker = excluded.ups_maker,
      ups_model = excluded.ups_model, remarks = excluded.remarks,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const row of rows) {
    let saved: Record<string, unknown> = {};
    try { saved = JSON.parse(String(row.details_json || '{}')) as Record<string, unknown>; } catch { saved = {}; }
    const value = (key: string, fallback: unknown = '') => String(saved[key] ?? fallback ?? '').trim();
    const stationName = value('stationName', row.site_name);
    upsert.run(
      String(row.id), value('keyNumber', row.cell_code), value('cellName', row.cell_name), stationName,
      value('stationAddress', row.site_address || row.address), value('otxNode', row.node_name),
      value('otxLineNumber', row.line_code), value('orxNode'), value('orxLineNumber'),
      value('spareNode'), value('spareLineNumber'), value('otxRack'), value('otxShelf'),
      value('otxPort'), value('otxModel'), value('orxRack'), value('orxShelf'), value('orxPort'),
      value('orxModel'), value('onuLocation', row.address), value('onuManufacturer'), value('onuModel'),
      value('onuDivision'), value('onuCellConfig'), value('upsLocation'), value('upsManufacturer'),
      value('upsModel'), value('notes', row.memo)
    );
  }
};

const rackCoordinatesOnly = (input: Record<string, unknown>) => Object.fromEntries(
  Object.entries(input).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const point = raw as Record<string, unknown>;
    const kind = textValue(point.type || point.kind).toLowerCase();
    const explicitRack = textValue(point.rackName);
    if (kind && kind !== 'rack' && !explicitRack) return [];
    const rackName = explicitRack || textValue(point.label) || textValue(key);
    let xRatio = Number(point.xRatio ?? point.x);
    let yRatio = Number(point.yRatio ?? point.y);
    if (xRatio > 1) xRatio /= 100;
    if (yRatio > 1) yRatio /= 100;
    if (!rackName || !Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return [];
    return [[rackName, {
      label: rackName,
      rackName,
      type: 'rack',
      equipmentType: textValue(point.equipmentType),
      xRatio,
      yRatio,
    }]];
  })
);

const migrateLegacyAdminAssets = async () => {
  const assets = db.prepare(`
    SELECT id, db_type, station_name, file_name, data_json, coordinates_json
      FROM admin_db_assets WHERE deleted_at IS NULL
  `).all() as Array<Record<string, unknown>>;
  for (const asset of assets) {
    let records: Array<Record<string, unknown>> = [];
    let coordinates: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(asset.data_json || '[]'));
      if (Array.isArray(parsed)) records = parsed;
    } catch { records = []; }
    try {
      const parsed = JSON.parse(String(asset.coordinates_json || '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) coordinates = parsed;
    } catch { coordinates = {}; }

    const stationName = textValue(asset.station_name);
    const fileName = textValue(asset.file_name);
    if (asset.db_type === 'floor_plan') coordinates = rackCoordinatesOnly(coordinates);
    if (asset.db_type === 'b2c') {
      const count = (db.prepare('SELECT COUNT(*) AS count FROM catv_b2c_lines WHERE station_name = ? AND source_file = ?').get(stationName, fileName) as { count: number }).count;
      if (count) continue;
      const insert = db.prepare(`
        INSERT INTO catv_b2c_lines (id, station_name, service_name, b2c_name, node, line, memo, search_values, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of records) {
        const value = (...keys: string[]) => {
          const key = keys.find((candidate) => row[candidate] !== undefined);
          return key ? textValue(row[key]) : '';
        };
        const serviceName = value('serviceName', '서비스회선명', '서비스 회선명');
        const b2cName = value('b2cName', 'B2C명', '셀명') || serviceName;
        const node = value('node', '노드', '노드명');
        const line = value('line', '선번');
        const memo = value('memo', '비고');
        const supplied = Array.isArray(row.searchValues) ? row.searchValues.map(textValue).filter(Boolean) : [];
        const searchValues = supplied.length ? supplied : [serviceName, b2cName, value('국사 FDF', '국사FDF'), value('서비스구분'), value('서비스타입'), memo].filter(Boolean);
        if (searchValues.length && (node || line)) insert.run(randomUUID(), stationName, serviceName, b2cName, node, line, memo, JSON.stringify(searchValues), fileName);
      }
    }

    if (asset.db_type === 'floor_plan' && !db.prepare('SELECT id FROM catv_floor_plans WHERE station_key = ?').get(normalizeStationName(stationName))) {
      const imageDataUrl = textValue(records[0]?.imageDataUrl);
      if (!imageDataUrl) continue;
      try {
        const planId = textValue(asset.id) || randomUUID();
        const stored = await saveFloorPlanDataUrl(planId, imageDataUrl);
        db.prepare(`INSERT INTO catv_floor_plans (id, station_name, station_key, file_name, object_key) VALUES (?, ?, ?, ?, ?)`)
          .run(planId, stationName, normalizeStationName(stationName), fileName, stored.objectKey);
        const insertCoordinate = db.prepare(`
          INSERT INTO catv_floor_plan_coordinates (id, floor_plan_id, label, node_name, rack_name, equipment_type, x_ratio, y_ratio)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [label, raw] of Object.entries(coordinates)) {
          if (!raw || typeof raw !== 'object') continue;
          const point = raw as Record<string, unknown>;
          let x = Number(point.xRatio ?? point.x);
          let y = Number(point.yRatio ?? point.y);
          if (x > 1) x /= 100;
          if (y > 1) y /= 100;
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;
          const rack = textValue(point.rackName) || textValue(point.label) || label;
          insertCoordinate.run(randomUUID(), planId, rack, '', rack, textValue(point.equipmentType), x, y);
        }
      } catch (error) {
        console.warn('기존 평면도 자산 마이그레이션을 건너뜁니다.', fileName, error);
      }
    }
  }
};

const removeLegacyFloorPlanNodeCoordinates = () => {
  db.prepare("DELETE FROM catv_floor_plan_coordinates WHERE trim(rack_name) = ''").run();
  const assets = db.prepare(`
    SELECT id, coordinates_json FROM admin_db_assets
     WHERE db_type = 'floor_plan' AND deleted_at IS NULL
  `).all() as Array<{ id: string; coordinates_json: string }>;
  const update = db.prepare('UPDATE admin_db_assets SET coordinates_json = ? WHERE id = ?');
  for (const asset of assets) {
    let coordinates: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(asset.coordinates_json || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) coordinates = parsed;
    } catch { coordinates = {}; }
    update.run(JSON.stringify(rackCoordinatesOnly(coordinates)), asset.id);
  }
};

export const initializeDatabase = async () => {
  createSchema();
  await seedDatabase();
  syncCatvCellsFromLegacy();
  await migrateLegacyAdminAssets();
  removeLegacyFloorPlanNodeCoordinates();
};
