import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApiApp } from '../app';
import { normalizeStationName } from '../catv';
import { db, initializeDatabase } from '../db';
import { straightMapStorageRoot, straightMapVersionRoot } from '../straight-map-storage';

await initializeDatabase();
const auditStart = (db.prepare('SELECT CURRENT_TIMESTAMP AS value').get() as { value: string }).value;
const suffix = Date.now().toString(36);
const stationName = `LIFECYCLE-${suffix}국사`;
const stationKey = normalizeStationName(stationName);
const assetId = randomUUID();
const mapId = randomUUID();
const versionId = randomUUID();
const objectId = randomUUID();
const sourceHash = createHash('sha256').update(versionId).digest('hex');
const sourcePath = path.join(straightMapStorageRoot, 'sources', `${sourceHash}.xlsx`);
const mapRoot = straightMapVersionRoot(mapId, 1);
const admin = db.prepare("SELECT id FROM users WHERE username = 'user-5'").get() as { id: string } | undefined;
assert.ok(admin?.id, '테스트 관리자 계정이 필요합니다.');

fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
fs.writeFileSync(sourcePath, 'test-source');
fs.mkdirSync(path.join(mapRoot, 'tiles', '1'), { recursive: true });
fs.writeFileSync(path.join(mapRoot, 'tiles', '1', '0_0.webp'), 'test-tile');

db.prepare(`
  INSERT INTO admin_db_assets (
    id, db_type, station_name, file_name, mime_type, file_size,
    record_count, coordinates_json, data_json, uploaded_by
  ) VALUES (?, 'b2c', ?, 'LIFECYCLE.xlsx', '', 100, 1, '{}', '[]', ?)
`).run(assetId, stationName, admin.id);
db.prepare(`
  INSERT INTO catv_b2c_lines (
    id, station_name, station_key, service_name, node, line, core,
    search_values, normalized_search, source_file
  ) VALUES (?, ?, ?, 'LIFECYCLE SERVICE', 'NODE', '1', '1', '[]', 'uniquedelete12345', 'LIFECYCLE.xlsx')
`).run(randomUUID(), stationName, stationKey);
db.prepare(`
  INSERT INTO map_versions (
    id, map_id, map_name, map_key, station_key, version, original_file_path,
    source_hash, sheet_name, map_width, map_height, rendered_width, rendered_height,
    tile_size, max_zoom, status
  ) VALUES (?, ?, 'LIFECYCLE MAP', 'lifecyclemap', ?, 1, ?, ?, 'LIFECYCLE MAP', 100, 100, 100, 100, 256, 7, 'ACTIVE')
`).run(versionId, mapId, stationKey, sourcePath, sourceHash);
db.prepare(`
  INSERT INTO map_objects (
    id, map_id, version_id, shape_id, shape_name, object_type, original_text,
    normalized_text, compact_text, x, y, width, height, center_x, center_y,
    x_ratio, y_ratio, group_id, rotation, shape_hash
  ) VALUES (?, ?, ?, '1', '', 'shape', 'UNIQUEDELETE12345', 'UNIQUEDELETE12345',
            'uniquedelete12345', 0, 0, 10, 10, 5, 5, 0.5, 0.5, NULL, 0, 'hash')
`).run(objectId, mapId, versionId);

const app = createApiApp();
const server: Server = await new Promise((resolve) => {
  const running = app.listen(0, '127.0.0.1', () => resolve(running));
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('테스트 서버를 시작하지 못했습니다.');
const base = `http://127.0.0.1:${address.port}/api`;

try {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'user-5', password: '1234' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const before = await fetch(`${base}/straight-maps/search?q=UNIQUEDELETE12345&matchLength=6&station=${encodeURIComponent(stationName)}`, { headers: { Cookie: cookie } });
  const beforePayload = await before.json() as { data?: { count: number } };
  assert.equal(beforePayload.data?.count, 1);

  const deleted = await fetch(`${base}/admin/db/assets/${assetId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(deleted.status, 200);
  assert.equal((db.prepare('SELECT count(*) AS count FROM catv_b2c_lines WHERE station_key = ?').get(stationKey) as { count: number }).count, 0);
  assert.equal((db.prepare('SELECT count(*) AS count FROM map_versions WHERE station_key = ?').get(stationKey) as { count: number }).count, 0);
  assert.equal((db.prepare('SELECT count(*) AS count FROM map_objects WHERE version_id = ?').get(versionId) as { count: number }).count, 0);
  assert.equal(fs.existsSync(path.join(straightMapStorageRoot, mapId)), false);
  assert.equal(fs.existsSync(sourcePath), false);

  const after = await fetch(`${base}/straight-maps/search?q=UNIQUEDELETE12345&matchLength=6&station=${encodeURIComponent(stationName)}`, { headers: { Cookie: cookie } });
  const afterPayload = await after.json() as { data?: { count: number } };
  assert.equal(afterPayload.data?.count, 0, '삭제 직후 검색 캐시에서도 직선도가 사라져야 합니다.');
  console.log('Straight-map lifecycle test passed: asset delete -> lines, versions, objects, tiles, source, cache cleanup');
} finally {
  db.prepare('DELETE FROM admin_db_assets WHERE id = ?').run(assetId);
  db.prepare('DELETE FROM map_versions WHERE station_key = ?').run(stationKey);
  db.prepare('DELETE FROM catv_b2c_lines WHERE station_key = ?').run(stationKey);
  db.prepare('DELETE FROM login_attempts WHERE created_at >= ?').run(auditStart);
  db.prepare('DELETE FROM audit_logs WHERE created_at >= ?').run(auditStart);
  db.prepare("DELETE FROM auth_sessions WHERE user_id = 'user-5'").run();
  fs.rmSync(path.join(straightMapStorageRoot, mapId), { recursive: true, force: true });
  fs.rmSync(sourcePath, { force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
