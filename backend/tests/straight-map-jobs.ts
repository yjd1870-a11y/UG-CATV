import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { db, initializeDatabase } from '../db';
import {
  cancelStraightMapJob,
  claimStraightMapJob,
  completeStraightMapUpload,
  createArtifactUploadUrls,
  createStraightMapUpload,
  failStraightMapJob,
  heartbeatStraightMapJob,
  registerStraightMapJobSheets,
  resumeStraightMapJobForSourceRepair,
  retryStraightMapJob,
  rollbackStraightMapVersion,
  straightMapCacheKey,
  straightMapRendererProfileHash,
  storeLocalStraightMapUpload,
  storeLocalStraightMapArtifact,
} from '../straight-map-jobs';

await initializeDatabase();

const insertJob = (id: string, status = 'WAITING_FOR_OFFICE_RENDERER') => db.prepare(`
  INSERT INTO straight_map_jobs (
    id, source_key, source_sha256, filename, station_name, station_key, status,
    source_size, source_content_type, renderer_profile_hash, max_attempts
  ) VALUES (?, ?, ?, 'test.xlsx', '송탄국사', '송탄', ?, 100, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ?, 3)
`).run(id, `line-diagrams/sources/${'a'.repeat(64)}.xlsx`, 'a'.repeat(64), status, straightMapRendererProfileHash());

const leasedJobId = randomUUID();
insertJob(leasedJobId);
const firstClaim = claimStraightMapJob('office-pc-a') as Record<string, unknown>;
assert.equal(firstClaim.id, leasedJobId);
assert.equal(firstClaim.attempt, 1);
const heartbeat = heartbeatStraightMapJob(leasedJobId, 'office-pc-a');
assert.ok(Date.parse(heartbeat.leaseExpiresAt) > Date.now());

db.prepare("UPDATE straight_map_jobs SET lease_expires_at = datetime('now', '-1 second') WHERE id = ?").run(leasedJobId);
const reclaimed = claimStraightMapJob('office-pc-b') as Record<string, unknown>;
assert.equal(reclaimed.id, leasedJobId);
assert.equal(reclaimed.attempt, 2);

const cacheKey = straightMapCacheKey('a'.repeat(64), '직선도1', straightMapRendererProfileHash());
const artifactSetId = randomUUID();
db.prepare(`
  INSERT INTO straight_map_artifact_sets (
    id, cache_key, source_sha256, sheet_name, renderer_profile_hash, r2_prefix,
    manifest_key, manifest_sha256, coordinate_hash, status, verified_at
  ) VALUES (?, ?, ?, '직선도1', ?, ?, ?, ?, ?, 'VERIFIED', CURRENT_TIMESTAMP)
`).run(artifactSetId, cacheKey, 'a'.repeat(64), straightMapRendererProfileHash(),
  `line-diagrams/artifacts/${artifactSetId}`, `line-diagrams/artifacts/${artifactSetId}/manifest.json`, 'b'.repeat(64), 'c'.repeat(64));
const sheets = registerStraightMapJobSheets(leasedJobId, 'office-pc-b', ['직선도1', '직선도2']) as Array<Record<string, unknown>>;
assert.equal(sheets[0].status, 'CACHE_HIT');
assert.equal(sheets[0].artifactSetId, artifactSetId);
assert.equal(sheets[1].status, 'PENDING');

const failed = failStraightMapJob(leasedJobId, 'office-pc-b', 'AGENT_STOPPED', 'forced stop');
assert.equal(failed.status, 'RETRY_WAIT');
assert.equal(failStraightMapJob(leasedJobId, 'office-pc-b', 'AGENT_STOPPED', 'duplicate').idempotent, true);
assert.equal(retryStraightMapJob(leasedJobId).status, 'WAITING_FOR_OFFICE_RENDERER');
assert.equal(cancelStraightMapJob(leasedJobId).status, 'CANCELLED');

const cancelledJobId = randomUUID();
insertJob(cancelledJobId);
assert.equal(cancelStraightMapJob(cancelledJobId).status, 'CANCELLED');
assert.equal(cancelStraightMapJob(cancelledJobId).idempotent, true);

const mapId = randomUUID();
const oldVersionId = randomUUID();
const newVersionId = randomUUID();
const oldArtifact = randomUUID();
const newArtifact = randomUUID();
db.prepare(`INSERT INTO straight_maps (map_id, map_name, map_key, station_key, active_artifact_set_id) VALUES (?, '직선도', '직선도', '송탄', ?)`)
  .run(mapId, newArtifact);
const insertVersion = db.prepare(`
  INSERT INTO map_versions (
    id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash,
    sheet_name, map_width, map_height, rendered_width, rendered_height, tile_size, max_zoom,
    status, artifact_set_id
  ) VALUES (?, ?, '직선도', '직선도', '송탄', ?, 'r2://source', ?, '직선도', 100, 100, 1000, 1000, 256, 10, ?, ?)
`);
insertVersion.run(oldVersionId, mapId, 1, '1'.repeat(64), 'ARCHIVED', oldArtifact);
insertVersion.run(newVersionId, mapId, 2, '2'.repeat(64), 'ACTIVE', newArtifact);
assert.equal(rollbackStraightMapVersion(oldVersionId).status, 'ACTIVE');
assert.equal((db.prepare('SELECT status FROM map_versions WHERE id = ?').get(oldVersionId) as { status: string }).status, 'ACTIVE');
assert.equal((db.prepare('SELECT status FROM map_versions WHERE id = ?').get(newVersionId) as { status: string }).status, 'ARCHIVED');
assert.equal((db.prepare('SELECT active_artifact_set_id AS id FROM straight_maps WHERE map_id = ?').get(mapId) as { id: string }).id, oldArtifact);

const localSource = Buffer.from('streamed local xlsx fixture');
const localSourceHash = createHash('sha256').update(localSource).digest('hex');
const localUpload = await createStraightMapUpload({
  sourceSha256: localSourceHash,
  filename: 'local-test.xlsx',
  size: localSource.length,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  stationName: '송탄국사',
  requestedBy: 'admin-test',
});
assert.equal(localUpload.uploadTarget, 'api');
assert.equal(localUpload.uploadRequired, true);
assert.match(String(localUpload.uploadUrl), /\/api\/admin\/straight-maps\/local-uploads\//);
const stored = await storeLocalStraightMapUpload(
  localUpload.jobId,
  'admin-test',
  Readable.from(localSource),
  localSource.length,
);
assert.equal(stored.uploaded, true);
assert.equal((await completeStraightMapUpload(localUpload.jobId, 'admin-test')).status, 'WAITING_FOR_OFFICE_RENDERER');

const localClaim = claimStraightMapJob('local-agent') as Record<string, unknown>;
assert.equal(localClaim.id, localUpload.jobId);
registerStraightMapJobSheets(localUpload.jobId, 'local-agent', ['직선도3']);
const localArtifact = Buffer.from('{"schemaVersion":1}');
const localArtifactHash = createHash('sha256').update(localArtifact).digest('hex');
const localArtifactSetId = randomUUID();
const preparedArtifact = await createArtifactUploadUrls(localUpload.jobId, 'local-agent', {
  sheetName: '직선도3',
  artifactSetId: localArtifactSetId,
  files: [{ relativeKey: 'source-info.json', size: localArtifact.length, contentType: 'application/json', sha256: localArtifactHash }],
});
assert.match(preparedArtifact.uploads[0].uploadUrl, /\/api\/renderer\/jobs\/.+\/artifacts\//);
assert.equal(preparedArtifact.uploads[0].requiredHeaders['Content-Type'], 'application/octet-stream');
const storedArtifact = await storeLocalStraightMapArtifact({
  jobId: localUpload.jobId,
  owner: 'local-agent',
  artifactSetId: localArtifactSetId,
  relativeKey: 'source-info.json',
  expectedSize: localArtifact.length,
  expectedSha256: localArtifactHash,
  declaredLength: localArtifact.length,
  body: Readable.from(localArtifact),
});
assert.equal(storedArtifact.uploaded, true);
assert.equal(failStraightMapJob(localUpload.jobId, 'local-agent', 'UPLOAD_INTERRUPTED', 'retry fixture').status, 'RETRY_WAIT');
assert.equal((claimStraightMapJob('local-agent-retry') as Record<string, unknown>).id, localUpload.jobId);
assert.equal(db.prepare('SELECT 1 FROM straight_map_artifact_sets WHERE id = ?').get(localArtifactSetId), undefined);
const retriedSheet = (registerStraightMapJobSheets(localUpload.jobId, 'local-agent-retry', ['직선도3']) as Array<Record<string, unknown>>)[0];
assert.equal(retriedSheet.artifactSetId, null);
const replacementArtifactSetId = randomUUID();
assert.equal((await createArtifactUploadUrls(localUpload.jobId, 'local-agent-retry', {
  sheetName: '직선도3',
  artifactSetId: replacementArtifactSetId,
  files: [{ relativeKey: 'source-info.json', size: localArtifact.length, contentType: 'application/json', sha256: localArtifactHash }],
})).artifactSetId, replacementArtifactSetId);

const exhaustedJobId = randomUUID();
insertJob(exhaustedJobId, 'WAITING_FOR_OFFICE_RENDERER');
db.prepare("UPDATE straight_map_jobs SET attempt = max_attempts, error_code = 'SOURCE_REPAIR_PENDING' WHERE id = ?").run(exhaustedJobId);
assert.equal(resumeStraightMapJobForSourceRepair(exhaustedJobId, 'a'.repeat(64)).status, 'WAITING_FOR_OFFICE_RENDERER');
const resumed = db.prepare('SELECT attempt, max_attempts AS maxAttempts FROM straight_map_jobs WHERE id = ?')
  .get(exhaustedJobId) as { attempt: number; maxAttempts: number };
assert.equal(resumed.maxAttempts, resumed.attempt + 1);

console.log('Straight-map v2 job test passed: local source/artifact streaming, lease reclaim, heartbeat, cache hit, retry, cancel, and atomic rollback.');
