import assert from 'node:assert/strict';
import { db, initializeDatabase } from '../db';

await initializeDatabase();

const user = db.prepare("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1")
  .get() as { id: string } | undefined;
assert.ok(user, 'The seed database must contain a user.');

db.prepare("UPDATE users SET department = '000 Restart Collision', region_id = NULL WHERE id = ?")
  .run(user.id);

await initializeDatabase();

const region = db.prepare("SELECT id FROM regions WHERE region_name = '000 Restart Collision'")
  .get() as { id: string } | undefined;
assert.ok(region, 'A newly discovered department must be added after a database restart.');

const linked = db.prepare('SELECT region_id AS regionId FROM users WHERE id = ?')
  .get(user.id) as { regionId: string | null };
assert.equal(linked.regionId, region.id, 'The user must be linked to the newly inserted region.');

console.log('Database restart test passed: department changes no longer collide with existing region IDs.');
