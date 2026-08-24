import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.STORAGE_DRIVER = 'r2';
process.env.R2_ENDPOINT = 'http://127.0.0.1:45678';
process.env.R2_ACCESS_KEY_ID = 'test-access';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.STRAIGHT_MAP_DIRECT_R2_UPLOAD_ENABLED = 'true';
process.env.STRAIGHT_MAP_PIPELINE_V3_ENABLED = 'true';
process.env.STRAIGHT_MAP_RENDERER_DEVICE_TOKEN = 'test-renderer-device-token-at-least-32-bytes';

const { db, initializeDatabase } = await import('../db');
const { createArtifactUploadUrls, registerStraightMapJobSheets, straightMapRendererProfileHash } = await import('../straight-map-jobs');
await initializeDatabase();
const jobId = randomUUID();
const owner = 'r2-test-agent';
db.prepare(`INSERT INTO straight_map_jobs (
  id, source_key, source_sha256, filename, station_name, station_key, status,
  source_size, source_content_type, renderer_profile_hash, lease_owner, lease_expires_at
) VALUES (?, ?, ?, 'r2.xlsx', '송탄국사', '송탄', 'CLAIMED', 100, ?, ?, ?, datetime('now', '+10 minutes'))`)
  .run(jobId, `line-diagrams/v3/sources/${'a'.repeat(64)}.xlsx`, 'a'.repeat(64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', straightMapRendererProfileHash(), owner);
registerStraightMapJobSheets(jobId, owner, ['직선도']);
const artifactSetId = randomUUID();
const prepared = await createArtifactUploadUrls(jobId, owner, {
  sheetName: '직선도', artifactSetId,
  files: [{ relativeKey: 'map.pdf', size: 123, contentType: 'application/pdf', sha256: 'b'.repeat(64) }],
});
const upload = prepared.uploads[0];
assert.equal(upload.uploadTarget, 'r2');
assert.match(upload.uploadUrl, /^http:\/\/127\.0\.0\.1:45678\/test-bucket\/line-diagrams\/v3\/documents\//);
assert.equal(upload.requiredHeaders['Content-Type'], 'application/pdf');
assert.equal(upload.requiredHeaders['x-amz-meta-sha256'], 'b'.repeat(64));
assert.equal(upload.requiredHeaders['Cache-Control'], 'private, max-age=31536000, immutable');
assert.match(String(upload.fallbackUploadUrl), /\/api\/renderer\/jobs\/.+\/artifacts\//);
assert.equal(upload.fallbackRequiredHeaders?.['Content-Type'], 'application/octet-stream');
console.log('Straight-map PDF v3 R2 URL test passed: renderer receives direct immutable PDF PUT with integrity metadata.');
