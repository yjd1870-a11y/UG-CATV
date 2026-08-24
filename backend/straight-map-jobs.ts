import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { db } from './db';
import { env } from './env';
import { ApiError } from './http';
import {
  deleteR2Object,
  headR2Object,
  inspectR2Prefix,
  putR2Object,
  putR2ObjectStream,
  r2SignedUrlExpiresAt,
  signedR2DownloadUrl,
  signedR2UploadUrl,
  usesR2Storage,
} from './object-storage';
import { normalizeStationName } from './catv';
import { normalizeStraightMapCompactText } from './straight-map-search';
import { invalidateStraightMapSearchCache } from './straight-map-cache';
import { resolveLocalStraightMapObject } from './straight-map-storage';

export const STRAIGHT_MAP_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const STRAIGHT_MAP_MAX_SOURCE_SIZE = 20 * 1024 * 1024;
export const STRAIGHT_MAP_UPLOAD_BATCH_LIMIT = 500;

const sha256Pattern = /^[a-f0-9]{64}$/;
const objectPartPattern = /^[A-Za-z0-9._가-힣-]+$/u;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const isoAfter = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const numericMetrics = (value: unknown) => {
  try {
    const parsed = JSON.parse(String(value || '{}')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])));
  } catch { return {} as Record<string, number>; }
};

export const straightMapRendererProfile = () => ({
  schemaVersion: 3,
  engine: 'windows-excel-pdf',
  excelRendererRevision: 'excel-com-vector-pdf-v3',
  pdfExportRevision: 'pdf-viewport-v3',
  pageLayoutRevision: 'tight-content-fit-one-page-v3',
  coordinateParserRevision: 'pdf-point-top-left-v3-calibration-interior-v3',
  cropAlgorithmRevision: 'actual-cell-shape-bounds-v3',
  uploadConcurrency: env.straightMapUploadConcurrency,
});

export const straightMapRendererProfileHash = () => {
  const { uploadConcurrency: _uploadConcurrency, ...artifactProfile } = straightMapRendererProfile();
  return sha256(JSON.stringify(artifactProfile));
};
export const straightMapCacheKey = (sourceSha256: string, sheetName: string, profileHash: string) => (
  sha256(`${sourceSha256}:${sheetName.normalize('NFC')}:${profileHash}`)
);

const requireV3 = () => {
  if (!env.straightMapPipelineV3Enabled) {
    throw new ApiError(409, 'PDF 직선도 파이프라인 기능 플래그가 비활성화되어 있습니다.', 'STRAIGHT_MAP_V3_DISABLED');
  }
};

const localSourcePath = (key: string) => resolveLocalStraightMapObject(key);

const localObjectHash = async (filePath: string) => {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), new Transform({
    transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(); },
  }));
  return hash.digest('hex');
};

const localObjectHead = async (key: string) => {
  const filePath = resolveLocalStraightMapObject(key);
  const stat = await fs.promises.stat(filePath);
  const sourceHash = /^line-diagrams\/v3\/sources\/([a-f0-9]{64})\.xlsx$/i.exec(key)?.[1]?.toLowerCase();
  return {
    contentType: key.endsWith('.xlsx') ? STRAIGHT_MAP_XLSX_MIME : key.endsWith('.pdf') ? 'application/pdf' : 'application/json',
    size: stat.size,
    etag: null,
    metadata: { sha256: sourceHash || await localObjectHash(filePath) },
    lastModified: stat.mtime.toISOString(),
  };
};

const storedObjectHead = async (key: string) => usesR2Storage ? headR2Object(key) : localObjectHead(key);

const inspectStoredPrefix = async (
  prefix: string,
  visitor: (object: { key: string; size: number; etag: string | null; lastModified: string | null }) => void | Promise<void>,
) => {
  if (usesR2Storage) return inspectR2Prefix(prefix, visitor);
  const marker = resolveLocalStraightMapObject(`${prefix.replace(/\/$/, '')}/__prefix__`);
  const root = path.dirname(marker);
  let count = 0;
  let totalSize = 0;
  const walk = async (directory: string, relative = ''): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(childPath, childRelative);
      else if (entry.isFile()) {
        const stat = await fs.promises.stat(childPath);
        count += 1;
        totalSize += stat.size;
        await visitor({ key: `${prefix}${childRelative}`, size: stat.size, etag: null, lastModified: stat.mtime.toISOString() });
      }
    }
  };
  await walk(root);
  return { count, totalSize };
};

const objectExists = async (key: string) => {
  if (!usesR2Storage) {
    try {
      return await localObjectHead(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  try {
    return await headR2Object(key);
  } catch (error) {
    const status = Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode || 0);
    if (status === 404) return null;
    throw error;
  }
};

export const createStraightMapUpload = async (input: {
  sourceSha256: string;
  filename: string;
  size: number;
  contentType: string;
  stationName: string;
  requestedBy: string;
}) => {
  requireV3();
  const sourceSha256 = input.sourceSha256.toLowerCase();
  if (!sha256Pattern.test(sourceSha256)) throw new ApiError(400, 'XLSX SHA-256 형식이 올바르지 않습니다.', 'INVALID_SOURCE_HASH');
  const filename = input.filename.trim().normalize('NFC');
  if (!/\.xlsx$/i.test(filename) || filename.length > 255) throw new ApiError(400, '.xlsx 파일만 등록할 수 있습니다.', 'INVALID_SOURCE_FILE');
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > STRAIGHT_MAP_MAX_SOURCE_SIZE) {
    throw new ApiError(400, '직선도 XLSX 파일은 20MB 이하여야 합니다.', 'INVALID_SOURCE_SIZE');
  }
  const stationName = input.stationName.trim();
  const stationKey = normalizeStationName(stationName);
  if (!stationKey) throw new ApiError(400, '직선도 국사명을 확인해주세요.', 'INVALID_STATION');
  const sourceKey = `line-diagrams/v3/sources/${sourceSha256}.xlsx`;
  const existing = await objectExists(sourceKey);
  if (existing && existing.size !== input.size) {
    throw new ApiError(409, '같은 해시의 R2 원본 크기가 일치하지 않습니다.', 'SOURCE_SIZE_CONFLICT');
  }
  const jobId = randomUUID();
  let reusedJobId: string | null = null;
  const contentType = STRAIGHT_MAP_XLSX_MIME;
  db.exec('BEGIN IMMEDIATE');
  try {
    const duplicate = db.prepare(`
      SELECT id, source_sha256 AS sourceSha256, source_size AS sourceSize,
             station_key AS stationKey, requested_by AS requestedBy, status
        FROM straight_map_jobs
       WHERE filename = ? COLLATE NOCASE
         AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
       LIMIT 1
    `).get(filename) as {
      id: string;
      sourceSha256: string;
      sourceSize: number;
      stationKey: string;
      requestedBy: string;
      status: string;
    } | undefined;
    if (duplicate) {
      const resumableUpload = duplicate.status === 'UPLOADING'
        && duplicate.sourceSha256 === sourceSha256
        && duplicate.sourceSize === input.size
        && duplicate.stationKey === stationKey
        && duplicate.requestedBy === input.requestedBy;
      if (!resumableUpload) {
        throw new ApiError(409, '같은 이름의 직선도 파일이 이미 업로드 또는 렌더링 중입니다. 기존 작업이 끝난 뒤 다시 시도해주세요.', 'DUPLICATE_ACTIVE_FILENAME');
      }
      reusedJobId = duplicate.id;
    } else {
      db.prepare(`
        INSERT INTO straight_map_jobs (
          id, source_key, source_sha256, filename, station_name, station_key, requested_by,
          status, source_size, source_content_type, renderer_profile_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADING', ?, ?, ?)
      `).run(jobId, sourceKey, sourceSha256, filename, stationName, stationKey, input.requestedBy,
        input.size, contentType, straightMapRendererProfileHash());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const uploadJobId = reusedJobId || jobId;
  try {
    if (usesR2Storage && !existing) {
      return {
        jobId: uploadJobId,
        sourceKey,
        uploadRequired: true,
        uploadUrl: await signedR2UploadUrl(sourceKey, contentType, input.size, { sha256: sourceSha256 }),
        uploadTarget: 'r2' as const,
        requiredHeaders: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=300',
          'x-amz-meta-sha256': sourceSha256,
        },
        expiresAt: r2SignedUrlExpiresAt(),
      };
    }
    return {
      jobId: uploadJobId,
      sourceKey,
      uploadRequired: !existing,
      uploadUrl: existing ? null : `/api/admin/straight-maps/local-uploads/${uploadJobId}`,
      uploadTarget: 'api' as const,
      requiredHeaders: existing ? {} : { 'Content-Type': contentType },
      expiresAt: null,
    };
  } catch (error) {
    if (!reusedJobId) db.prepare("DELETE FROM straight_map_jobs WHERE id = ? AND status = 'UPLOADING'").run(jobId);
    throw error;
  }
};

export const storeLocalStraightMapUpload = async (
  jobId: string,
  requestedBy: string,
  body: Readable,
  declaredLength: number | null,
) => {
  requireV3();
  const job = db.prepare(`
    SELECT source_key AS sourceKey, source_sha256 AS sourceSha256, source_size AS sourceSize,
           status, requested_by AS requestedBy
      FROM straight_map_jobs WHERE id = ?
  `).get(jobId) as { sourceKey: string; sourceSha256: string; sourceSize: number; status: string; requestedBy: string } | undefined;
  if (!job || job.requestedBy !== requestedBy) throw new ApiError(404, '직선도 업로드 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (job.status !== 'UPLOADING') throw new ApiError(409, '이미 업로드가 끝난 직선도 작업입니다.', 'UPLOAD_ALREADY_COMPLETED');
  if (declaredLength !== null && declaredLength !== job.sourceSize) {
    throw new ApiError(400, '업로드 파일 크기가 요청과 다릅니다.', 'SOURCE_SIZE_MISMATCH');
  }

  if (usesR2Storage) {
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > STRAIGHT_MAP_MAX_SOURCE_SIZE || received > job.sourceSize) {
        throw new ApiError(413, '직선도 XLSX 파일은 20MB 이하여야 합니다.', 'SOURCE_TOO_LARGE');
      }
      chunks.push(buffer);
    }
    if (received !== job.sourceSize) throw new ApiError(409, '업로드 파일 크기가 요청과 다릅니다.', 'SOURCE_SIZE_MISMATCH');
    const source = Buffer.concat(chunks, received);
    if (createHash('sha256').update(source).digest('hex') !== job.sourceSha256) {
      throw new ApiError(409, '업로드 파일 SHA-256이 요청과 다릅니다.', 'SOURCE_HASH_MISMATCH');
    }
    const existing = await objectExists(job.sourceKey);
    if (existing) {
      if (existing.size !== received) throw new ApiError(409, '같은 해시의 R2 원본 크기가 일치하지 않습니다.', 'SOURCE_SIZE_CONFLICT');
    } else {
      await putR2Object(job.sourceKey, source, STRAIGHT_MAP_XLSX_MIME, { sha256: job.sourceSha256 });
    }
    return { jobId, uploaded: true, size: received };
  }

  const target = localSourcePath(job.sourceKey);
  const temporary = `${target}.${jobId}.upload`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.rm(temporary, { force: true });
  const hash = createHash('sha256');
  let received = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > STRAIGHT_MAP_MAX_SOURCE_SIZE || received > job.sourceSize) {
        callback(new ApiError(413, '직선도 XLSX 파일은 20MB 이하여야 합니다.', 'SOURCE_TOO_LARGE'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(body, verifier, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (received !== job.sourceSize) throw new ApiError(409, '업로드 파일 크기가 요청과 다릅니다.', 'SOURCE_SIZE_MISMATCH');
    if (hash.digest('hex') !== job.sourceSha256) throw new ApiError(409, '업로드 파일 SHA-256이 요청과 다릅니다.', 'SOURCE_HASH_MISMATCH');
    const existing = await objectExists(job.sourceKey);
    if (existing) {
      if (existing.size !== received) throw new ApiError(409, '같은 해시의 로컬 원본 크기가 일치하지 않습니다.', 'SOURCE_SIZE_CONFLICT');
      await fs.promises.rm(temporary, { force: true });
    } else {
      await fs.promises.rename(temporary, target);
    }
    return { jobId, uploaded: true, size: received };
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const completeStraightMapUpload = async (jobId: string, requestedBy: string) => {
  requireV3();
  const job = db.prepare(`
    SELECT id, source_key AS sourceKey, source_sha256 AS sourceSha256, source_size AS sourceSize,
           status, requested_by AS requestedBy
      FROM straight_map_jobs WHERE id = ?
  `).get(jobId) as { id: string; sourceKey: string; sourceSha256: string; sourceSize: number; status: string; requestedBy: string } | undefined;
  if (!job || job.requestedBy !== requestedBy) throw new ApiError(404, '직선도 업로드 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (job.status !== 'UPLOADING') return { jobId, status: job.status, idempotent: true };
  const object = await objectExists(job.sourceKey);
  if (!object) throw new ApiError(409, '업로드된 XLSX를 저장소에서 찾을 수 없습니다.', 'SOURCE_NOT_UPLOADED');
  if (object.size !== job.sourceSize) throw new ApiError(409, '업로드된 XLSX 크기가 요청과 다릅니다.', 'SOURCE_SIZE_MISMATCH');
  const storedHash = String(object.metadata.sha256 || '').toLowerCase();
  if (storedHash && storedHash !== job.sourceSha256) throw new ApiError(409, '업로드된 XLSX 해시 메타데이터가 다릅니다.', 'SOURCE_HASH_MISMATCH');
  db.prepare(`
    UPDATE straight_map_jobs
       SET status = 'WAITING_FOR_OFFICE_RENDERER', current_step = '사무실 렌더러 실행 대기 중', progress = 0
     WHERE id = ? AND status = 'UPLOADING'
  `).run(jobId);
  return { jobId, status: 'WAITING_FOR_OFFICE_RENDERER', idempotent: false };
};

export const listStraightMapJobs = () => db.prepare(`
  SELECT j.id, j.filename, j.station_name AS stationName, j.source_sha256 AS sourceSha256,
         j.status, j.total_sheets AS totalSheets, j.completed_sheets AS completedSheets,
         j.progress, j.current_sheet AS currentSheet, j.current_step AS currentStep,
         j.lease_owner AS leaseOwner, j.lease_expires_at AS leaseExpiresAt,
         j.heartbeat_at AS heartbeatAt, j.attempt, j.max_attempts AS maxAttempts,
         j.error_code AS errorCode, j.error_message AS errorMessage,
         j.created_at AS createdAt, j.started_at AS startedAt, j.completed_at AS completedAt,
         j.metrics_json AS metricsJson, j.total_tile_count AS totalTileCount,
         j.total_artifact_bytes AS totalArtifactBytes,
         COALESCE(SUM(CASE WHEN s.status = 'CACHE_HIT' THEN 1 ELSE 0 END), 0) AS cacheHitSheets
    FROM straight_map_jobs j
    LEFT JOIN straight_map_job_sheets s ON s.job_id = j.id
   GROUP BY j.id
   ORDER BY j.created_at DESC LIMIT 100
`).all();

export const retryStraightMapJob = (jobId: string) => {
  const changed = db.prepare(`
    UPDATE straight_map_jobs
       SET status = 'WAITING_FOR_OFFICE_RENDERER', error_code = NULL, error_message = NULL,
           lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, current_step = '재시도 대기 중',
           max_attempts = MAX(max_attempts, attempt + 1)
     WHERE id = ? AND status IN ('FAILED', 'RETRY_WAIT', 'CANCELLED')
  `).run(jobId);
  if (!changed.changes) throw new ApiError(409, '재시도할 수 없는 작업 상태입니다.', 'JOB_NOT_RETRYABLE');
  return { jobId, status: 'WAITING_FOR_OFFICE_RENDERER' };
};

export const cancelStraightMapJob = (jobId: string) => {
  const current = db.prepare('SELECT status FROM straight_map_jobs WHERE id = ?').get(jobId) as { status: string } | undefined;
  if (!current) throw new ApiError(404, '직선도 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(current.status)) return { jobId, status: current.status, idempotent: true };
  const claimed = Boolean(db.prepare("SELECT 1 FROM straight_map_jobs WHERE id = ? AND lease_owner IS NOT NULL AND datetime(lease_expires_at) > CURRENT_TIMESTAMP").get(jobId));
  const status = claimed ? 'CANCEL_REQUESTED' : 'CANCELLED';
  db.prepare(`UPDATE straight_map_jobs SET status = ?, cancelled_at = CASE WHEN ? = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END WHERE id = ?`)
    .run(status, status, jobId);
  return { jobId, status, idempotent: false };
};

export const deleteStraightMapJob = (jobId: string) => {
  const current = db.prepare('SELECT status FROM straight_map_jobs WHERE id = ?').get(jobId) as { status: string } | undefined;
  if (!current) throw new ApiError(404, '직선도 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (!['FAILED', 'CANCELLED'].includes(current.status)) {
    throw new ApiError(409, '실패 또는 취소가 완료된 직선도 작업만 삭제할 수 있습니다.', 'JOB_NOT_DELETABLE');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE straight_map_artifact_sets SET status = 'FAILED'
       WHERE id IN (SELECT artifact_set_id FROM straight_map_job_sheets WHERE job_id = ?)
         AND status IN ('PREPARING', 'STAGED')
    `).run(jobId);
    db.prepare('DELETE FROM straight_map_jobs WHERE id = ?').run(jobId);
    db.prepare(`
      DELETE FROM straight_map_artifact_sets
       WHERE status = 'FAILED'
         AND NOT EXISTS (SELECT 1 FROM straight_map_job_sheets WHERE artifact_set_id = straight_map_artifact_sets.id)
         AND NOT EXISTS (SELECT 1 FROM map_versions WHERE artifact_set_id = straight_map_artifact_sets.id)
    `).run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { jobId, deleted: true };
};

export const resumeStraightMapJobForSourceRepair = (jobId: string, sourceSha256: string) => {
  if (!sha256Pattern.test(sourceSha256)) throw new ApiError(400, '원본 SHA-256을 확인해주세요.', 'INVALID_SOURCE_SHA256');
  const job = db.prepare(`
    SELECT status, source_sha256 AS sourceSha256, lease_owner AS leaseOwner
      FROM straight_map_jobs WHERE id = ?
  `).get(jobId) as { status: string; sourceSha256: string; leaseOwner: string | null } | undefined;
  if (!job) throw new ApiError(404, '직선도 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (job.sourceSha256 !== sourceSha256 || job.leaseOwner
    || !['FAILED', 'RETRY_WAIT', 'WAITING_FOR_OFFICE_RENDERER'].includes(job.status)) {
    throw new ApiError(409, '원본 복구로 재개할 수 없는 작업입니다.', 'SOURCE_REPAIR_NOT_RESUMABLE');
  }
  db.prepare(`
    UPDATE straight_map_jobs
       SET status = 'WAITING_FOR_OFFICE_RENDERER', max_attempts = MAX(max_attempts, attempt + 1),
           error_code = NULL, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL,
           heartbeat_at = NULL, current_step = '누락 원본 복구 재시도 대기 중'
     WHERE id = ?
  `).run(jobId);
  return { jobId, status: 'WAITING_FOR_OFFICE_RENDERER' };
};

const claimedJob = (jobId: string, owner: string) => {
  const job = db.prepare(`
    SELECT * FROM straight_map_jobs
     WHERE id = ? AND lease_owner = ? AND datetime(lease_expires_at) > CURRENT_TIMESTAMP
  `).get(jobId, owner) as Record<string, unknown> | undefined;
  if (!job) throw new ApiError(409, '작업 lease가 없거나 만료되었습니다.', 'LEASE_NOT_OWNED');
  return job;
};

export const claimStraightMapJob = (owner: string) => {
  if (!owner.trim() || owner.length > 120) throw new ApiError(400, '렌더러 ID를 확인해주세요.', 'INVALID_RENDERER_ID');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE straight_map_jobs
         SET status = 'FAILED', error_code = 'MAX_ATTEMPTS_EXHAUSTED',
             error_message = 'Lease가 만료되었고 최대 시도 횟수에 도달했습니다.', lease_owner = NULL
       WHERE status IN ('CLAIMED', 'DOWNLOADING', 'ANALYZING', 'EXCEL_RENDERING', 'PUBLISHING', 'VERIFYING')
         AND datetime(lease_expires_at) <= CURRENT_TIMESTAMP AND attempt >= max_attempts
    `).run();
    const job = db.prepare(`
      SELECT id FROM straight_map_jobs
       WHERE (
         status = 'WAITING_FOR_OFFICE_RENDERER'
         OR (status IN ('CLAIMED', 'DOWNLOADING', 'ANALYZING', 'EXCEL_RENDERING', 'PUBLISHING', 'VERIFYING')
             AND datetime(lease_expires_at) <= CURRENT_TIMESTAMP)
         OR (status = 'RETRY_WAIT' AND datetime(COALESCE(lease_expires_at, CURRENT_TIMESTAMP)) <= CURRENT_TIMESTAMP)
       )
       AND attempt < max_attempts
       ORDER BY created_at LIMIT 1
    `).get() as { id: string } | undefined;
    if (!job) {
      db.exec('COMMIT');
      return null;
    }
    db.prepare(`
      UPDATE straight_map_job_sheets
         SET status = 'PENDING', artifact_set_id = NULL, progress = 0,
             started_at = NULL, completed_at = NULL
       WHERE job_id = ? AND status <> 'CACHE_HIT'
         AND artifact_set_id IN (
           SELECT id FROM straight_map_artifact_sets WHERE status = 'FAILED'
         )
    `).run(job.id);
    db.prepare(`
      DELETE FROM straight_map_artifact_sets
       WHERE status = 'FAILED'
         AND NOT EXISTS (
           SELECT 1 FROM straight_map_job_sheets WHERE artifact_set_id = straight_map_artifact_sets.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM map_versions WHERE artifact_set_id = straight_map_artifact_sets.id
         )
    `).run();
    const leaseExpiresAt = isoAfter(env.straightMapLeaseSeconds);
    const updated = db.prepare(`
      UPDATE straight_map_jobs
         SET status = 'CLAIMED', lease_owner = ?, lease_expires_at = ?, heartbeat_at = CURRENT_TIMESTAMP,
             attempt = attempt + 1, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), current_step = '작업 CLAIM 완료'
       WHERE id = ?
    `).run(owner, leaseExpiresAt, job.id);
    if (!updated.changes) throw new Error('직선도 작업 CLAIM이 충돌했습니다.');
    const result = db.prepare(`
      SELECT id, source_key AS sourceKey, source_sha256 AS sourceSha256, filename,
             station_name AS stationName, renderer_profile_hash AS rendererProfileHash,
             attempt, max_attempts AS maxAttempts, lease_expires_at AS leaseExpiresAt
        FROM straight_map_jobs WHERE id = ?
    `).get(job.id);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

export const straightMapSourceDownload = async (jobId: string, owner: string) => {
  const job = claimedJob(jobId, owner);
  if (!usesR2Storage) {
    return {
      downloadUrl: `/api/renderer/jobs/${encodeURIComponent(jobId)}/source?rendererId=${encodeURIComponent(owner)}`,
      expiresAt: null,
      downloadTarget: 'api',
    };
  }
  return { downloadUrl: await signedR2DownloadUrl(String(job.source_key)), expiresAt: r2SignedUrlExpiresAt() };
};

export const localStraightMapSourceFile = (jobId: string, owner: string) => {
  if (usesR2Storage) throw new ApiError(404, '로컬 원본 다운로드를 사용할 수 없습니다.', 'LOCAL_SOURCE_UNAVAILABLE');
  const job = claimedJob(jobId, owner);
  return localSourcePath(String(job.source_key));
};

export const createStraightMapSourceRepairUploadUrl = async (jobId: string, owner: string) => {
  if (!usesR2Storage) throw new ApiError(404, 'R2 원본 복구는 운영 저장소에서만 사용할 수 있습니다.', 'SOURCE_REPAIR_UNAVAILABLE');
  const job = claimedJob(jobId, owner);
  const sourceKey = String(job.source_key);
  const existing = await objectExists(sourceKey);
  if (existing) return { uploadRequired: false, uploadUrl: null, requiredHeaders: {}, expiresAt: null };
  const sourceSize = Number(job.source_size);
  const sourceSha256 = String(job.source_sha256);
  return {
    uploadRequired: true,
    uploadUrl: await signedR2UploadUrl(sourceKey, STRAIGHT_MAP_XLSX_MIME, sourceSize, { sha256: sourceSha256 }),
    requiredHeaders: {
      'Content-Type': STRAIGHT_MAP_XLSX_MIME,
      'Cache-Control': 'private, max-age=300',
      'x-amz-meta-sha256': sourceSha256,
    },
    expiresAt: r2SignedUrlExpiresAt(),
  };
};

export const heartbeatStraightMapJob = (jobId: string, owner: string) => {
  const job = claimedJob(jobId, owner);
  const leaseExpiresAt = isoAfter(env.straightMapLeaseSeconds);
  db.prepare(`UPDATE straight_map_jobs SET heartbeat_at = CURRENT_TIMESTAMP, lease_expires_at = ? WHERE id = ? AND lease_owner = ?`)
    .run(leaseExpiresAt, jobId, owner);
  return { jobId, leaseExpiresAt, cancelRequested: job.status === 'CANCEL_REQUESTED' };
};

const rendererStates = new Set(['DOWNLOADING', 'ANALYZING', 'EXCEL_RENDERING', 'PUBLISHING', 'VERIFYING']);
export const progressStraightMapJob = (jobId: string, owner: string, input: {
  status: string;
  progress: number;
  currentSheet?: string;
  currentStep?: string;
  metrics?: Record<string, number>;
  tileCount?: number;
  artifactBytes?: number;
}) => {
  const job = claimedJob(jobId, owner);
  if (job.status === 'CANCEL_REQUESTED') return { jobId, status: 'CANCEL_REQUESTED', progress: Number(job.progress) };
  if (!rendererStates.has(input.status)) throw new ApiError(400, '렌더러 작업 상태가 올바르지 않습니다.', 'INVALID_JOB_STATUS');
  const progress = Math.min(99.9, Math.max(0, Number(input.progress)));
  if (!Number.isFinite(progress)) throw new ApiError(400, '진행률이 올바르지 않습니다.', 'INVALID_PROGRESS');
  db.prepare(`
    UPDATE straight_map_jobs SET status = ?, progress = ?, current_sheet = ?, current_step = ?,
           metrics_json = ?, total_tile_count = MAX(total_tile_count, ?),
           total_artifact_bytes = MAX(total_artifact_bytes, ?),
           heartbeat_at = CURRENT_TIMESTAMP, lease_expires_at = ? WHERE id = ? AND lease_owner = ?
  `).run(input.status, progress, input.currentSheet?.slice(0, 255) || null, input.currentStep?.slice(0, 255) || null,
    JSON.stringify(input.metrics || numericMetrics(job.metrics_json)),
    Math.max(0, Math.floor(input.tileCount || Number(job.total_tile_count) || 0)),
    Math.max(0, Math.floor(input.artifactBytes || Number(job.total_artifact_bytes) || 0)),
    isoAfter(env.straightMapLeaseSeconds), jobId, owner);
  return { jobId, status: input.status, progress };
};

export const registerStraightMapJobSheets = (jobId: string, owner: string, sheetNames: string[], sheetHashes: Record<string, string> = {}) => {
  const job = claimedJob(jobId, owner);
  const unique = [...new Set(sheetNames.map((name) => name.trim()).filter(Boolean))];
  if (!unique.length || unique.length > 200) throw new ApiError(400, '렌더링할 시트 목록을 확인해주세요.', 'INVALID_SHEETS');
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare(`
      INSERT INTO straight_map_job_sheets (id, job_id, sheet_name, status, cache_key, artifact_set_id, completed_at, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, sheet_name) DO NOTHING
    `);
    for (const sheetName of unique) {
      const sheetHash = /^[a-f0-9]{64}$/.test(sheetHashes[sheetName] || '') ? sheetHashes[sheetName] : String(job.source_sha256);
      const cacheKey = straightMapCacheKey(sheetHash, sheetName, String(job.renderer_profile_hash));
      const existingArtifact = db.prepare(`SELECT id, status FROM straight_map_artifact_sets WHERE cache_key = ?`).get(cacheKey) as { id: string; status: string } | undefined;
      const cached = existingArtifact?.status === 'VERIFIED' ? existingArtifact : undefined;
      insert.run(randomUUID(), jobId, sheetName, cached ? 'CACHE_HIT' : 'PENDING', cacheKey, existingArtifact?.id || null,
        cached ? new Date().toISOString() : null, cached ? 100 : 0);
    }
    db.prepare(`
      UPDATE straight_map_jobs SET total_sheets = ?, completed_sheets = (
        SELECT COUNT(*) FROM straight_map_job_sheets WHERE job_id = ? AND status = 'CACHE_HIT'
      ), status = 'ANALYZING', current_step = '시트 분석 완료' WHERE id = ?
    `).run(unique.length, jobId, jobId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return db.prepare(`
    SELECT id, sheet_name AS sheetName, status, cache_key AS cacheKey, artifact_set_id AS artifactSetId,
           checkpoint_json AS checkpointJson
      FROM straight_map_job_sheets WHERE job_id = ? ORDER BY rowid
  `).all(jobId);
};

type UploadFile = { relativeKey: string; size: number; contentType: string; sha256: string };
const artifactContentType = (relativeKey: string) => relativeKey.endsWith('.pdf') ? 'application/pdf' : 'application/json';
const validateArtifactPart = (value: string) => value.split('/').every((part) => objectPartPattern.test(part));

export const createArtifactUploadUrls = async (jobId: string, owner: string, input: {
  sheetName: string;
  artifactSetId?: string;
  files: UploadFile[];
}) => {
  const job = claimedJob(jobId, owner);
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > STRAIGHT_MAP_UPLOAD_BATCH_LIMIT) {
    throw new ApiError(400, `업로드 URL은 한 번에 ${STRAIGHT_MAP_UPLOAD_BATCH_LIMIT}개 이하로 요청해야 합니다.`, 'INVALID_UPLOAD_BATCH');
  }
  const sheet = db.prepare(`SELECT * FROM straight_map_job_sheets WHERE job_id = ? AND sheet_name = ?`).get(jobId, input.sheetName) as Record<string, unknown> | undefined;
  if (!sheet || sheet.status === 'CACHE_HIT') throw new ApiError(409, '렌더링 대상 시트를 찾을 수 없습니다.', 'SHEET_NOT_RENDERABLE');
  const assignedArtifactSetId = typeof sheet.artifact_set_id === 'string' ? sheet.artifact_set_id : null;
  const artifactSetId = input.artifactSetId || assignedArtifactSetId || randomUUID();
  if (assignedArtifactSetId && assignedArtifactSetId !== artifactSetId) {
    throw new ApiError(409, '이 시트에 이미 다른 artifact set이 할당되어 있습니다.', 'ARTIFACT_ID_CONFLICT');
  }
  if (!/^[a-f0-9-]{36}$/i.test(artifactSetId)) throw new ApiError(400, 'artifact set ID가 올바르지 않습니다.', 'INVALID_ARTIFACT_ID');
  const prefix = `line-diagrams/v3/documents/${artifactSetId}`;
  const manifestKey = `${prefix}/manifest.json`;
  db.prepare(`
    INSERT INTO straight_map_artifact_sets (
      id, cache_key, source_sha256, sheet_name, renderer_profile_hash, r2_prefix, manifest_key, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PREPARING')
    ON CONFLICT(id) DO NOTHING
  `).run(artifactSetId, String(sheet.cache_key), String(job.source_sha256), input.sheetName, String(job.renderer_profile_hash), prefix, manifestKey);
  db.prepare("UPDATE straight_map_artifact_sets SET status = 'PREPARING' WHERE id = ? AND status <> 'VERIFIED'").run(artifactSetId);
  db.prepare(`UPDATE straight_map_job_sheets SET artifact_set_id = ?, status = 'RENDERING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`)
    .run(artifactSetId, String(sheet.id));
  const uploads = await Promise.all(input.files.map(async (file) => {
    if (!['map.pdf', 'coordinates.json', 'manifest.json'].includes(file.relativeKey)) {
      throw new ApiError(400, 'PDF v3는 map.pdf, coordinates.json, manifest.json만 허용합니다.', 'UNEXPECTED_ARTIFACT_OBJECT');
    }
    if (!validateArtifactPart(file.relativeKey) || file.relativeKey.startsWith('/') || file.relativeKey.includes('..')) {
      throw new ApiError(400, 'artifact 상대 경로가 올바르지 않습니다.', 'INVALID_ARTIFACT_PATH');
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 512 * 1024 * 1024 || !sha256Pattern.test(file.sha256)) {
      throw new ApiError(400, 'artifact 파일 크기 또는 해시가 올바르지 않습니다.', 'INVALID_ARTIFACT_FILE');
    }
    if (file.contentType !== artifactContentType(file.relativeKey)) {
      throw new ApiError(400, 'artifact 파일 형식이 경로와 일치하지 않습니다.', 'INVALID_ARTIFACT_CONTENT_TYPE');
    }
    const objectKey = `${prefix}/${file.relativeKey}`;
    const apiUploadUrl = `/api/renderer/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactSetId)}`
      + `?rendererId=${encodeURIComponent(owner)}&relativeKey=${encodeURIComponent(file.relativeKey)}`
      + `&size=${file.size}&sha256=${file.sha256}`;
    if (usesR2Storage && env.straightMapDirectR2UploadEnabled) {
      return {
        relativeKey: file.relativeKey,
        objectKey,
        uploadTarget: 'r2' as const,
        uploadUrl: await signedR2UploadUrl(objectKey, file.contentType, file.size, { sha256: file.sha256 }),
        requiredHeaders: {
          'Content-Type': file.contentType,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'x-amz-meta-sha256': file.sha256,
        },
        fallbackUploadUrl: apiUploadUrl,
        fallbackRequiredHeaders: { 'Content-Type': 'application/octet-stream' },
      };
    }
    return {
      relativeKey: file.relativeKey,
      objectKey,
      uploadTarget: 'api' as const,
      uploadUrl: apiUploadUrl,
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    };
  }));
  return { artifactSetId, prefix, expiresAt: null, uploads };
};

export const storeLocalStraightMapArtifact = async (input: {
  jobId: string;
  owner: string;
  artifactSetId: string;
  relativeKey: string;
  expectedSize: number;
  expectedSha256: string;
  declaredLength: number | null;
  body: Readable;
}) => {
  claimedJob(input.jobId, input.owner);
  if (!/^[a-f0-9-]{36}$/i.test(input.artifactSetId) || !validateArtifactPart(input.relativeKey)
    || input.relativeKey.startsWith('/') || input.relativeKey.includes('..')) {
    throw new ApiError(400, 'artifact 경로가 올바르지 않습니다.', 'INVALID_ARTIFACT_PATH');
  }
  if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize <= 0 || input.expectedSize > 512 * 1024 * 1024
    || !sha256Pattern.test(input.expectedSha256)) {
    throw new ApiError(400, 'artifact 크기 또는 해시가 올바르지 않습니다.', 'INVALID_ARTIFACT_FILE');
  }
  if (input.declaredLength !== null && input.declaredLength !== input.expectedSize) {
    throw new ApiError(400, 'artifact Content-Length가 요청과 다릅니다.', 'ARTIFACT_SIZE_MISMATCH');
  }
  const assigned = db.prepare(`
    SELECT 1 FROM straight_map_job_sheets
     WHERE job_id = ? AND artifact_set_id = ? AND status = 'RENDERING'
  `).get(input.jobId, input.artifactSetId);
  if (!assigned) throw new ApiError(409, '작업에 할당되지 않은 artifact set입니다.', 'ARTIFACT_NOT_ASSIGNED');
  const objectKey = `line-diagrams/v3/documents/${input.artifactSetId}/${input.relativeKey}`;
  if (usesR2Storage) {
    const hash = createHash('sha256');
    let received = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > input.expectedSize) {
          callback(new ApiError(413, 'artifact 크기가 요청보다 큽니다.', 'ARTIFACT_TOO_LARGE'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await putR2ObjectStream(
        objectKey,
        input.body.pipe(verifier),
        input.expectedSize,
        artifactContentType(input.relativeKey),
        { sha256: input.expectedSha256 },
      );
      if (received !== input.expectedSize) {
        throw new ApiError(409, 'artifact 크기가 요청과 다릅니다.', 'ARTIFACT_SIZE_MISMATCH');
      }
      if (hash.digest('hex') !== input.expectedSha256) {
        throw new ApiError(409, 'artifact SHA-256이 요청과 다릅니다.', 'ARTIFACT_HASH_MISMATCH');
      }
      return { uploaded: true, relativeKey: input.relativeKey, size: received };
    } catch (error) {
      await deleteR2Object(objectKey).catch(() => undefined);
      throw error;
    }
  }
  const target = resolveLocalStraightMapObject(objectKey);
  const temporary = `${target}.${randomUUID()}.upload`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const hash = createHash('sha256');
  let received = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > input.expectedSize) {
        callback(new ApiError(413, 'artifact 크기가 요청보다 큽니다.', 'ARTIFACT_TOO_LARGE'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(input.body, verifier, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (received !== input.expectedSize) throw new ApiError(409, 'artifact 크기가 요청과 다릅니다.', 'ARTIFACT_SIZE_MISMATCH');
    if (hash.digest('hex') !== input.expectedSha256) throw new ApiError(409, 'artifact SHA-256이 요청과 다릅니다.', 'ARTIFACT_HASH_MISMATCH');
    try {
      const existing = await localObjectHead(objectKey);
      if (existing.size !== received || existing.metadata.sha256 !== input.expectedSha256) {
        throw new ApiError(409, '기존 artifact와 업로드 내용이 다릅니다.', 'ARTIFACT_CONFLICT');
      }
      await fs.promises.rm(temporary, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.promises.rename(temporary, target);
    }
    return { uploaded: true, relativeKey: input.relativeKey, size: received };
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export type StraightMapCoordinate = {
  shapeId: string;
  label: string;
  pageIndex: number;
  pageXPoints: number;
  pageYPoints: number;
  worldXPoints: number;
  worldYPoints: number;
  xRatio: number;
  yRatio: number;
  widthPoints?: number;
  heightPoints?: number;
};

export type StraightMapArtifactManifest = {
  schemaVersion: number;
  complete: boolean;
  jobId: string;
  artifactSetId: string;
  sourceSha256: string;
  sheetName: string;
  rendererProfileHash: string;
  rendererEngine: string;
  renderMode: 'pdf-viewport-v3';
  excelPrintArea: string;
  worksheetWidthPoints: number;
  worksheetHeightPoints: number;
  pageCount: number;
  pagePlacements: Array<{ pageIndex: number; xPoints: number; yPoints: number; widthPoints: number; heightPoints: number }>;
  contentBounds: { xPoints: number; yPoints: number; widthPoints: number; heightPoints: number };
  worldWidthPoints: number;
  worldHeightPoints: number;
  coordinateSystem: { unit: 'pdf-point'; origin: 'top-left'; pointsPerInch: 72 };
  coordinateCalibration?: 'pdf-text-anchors' | 'page-fit-fallback';
  coordinateCount: number;
  coordinateHash: string;
  files: Record<'map.pdf' | 'coordinates.json', { sha256: string; size: number; contentType: string }>;
};

export type CompletedArtifact = {
  artifactSetId: string;
  sheetName: string;
  manifestSha256: string;
  manifest: StraightMapArtifactManifest;
  coordinates: StraightMapCoordinate[];
};

const validPositive = (value: number) => Number.isFinite(value) && value > 0;
const verifyManifestShape = (jobId: string, job: Record<string, unknown>, artifact: CompletedArtifact) => {
  const manifest = artifact.manifest;
  if (manifest.schemaVersion !== 3 || manifest.renderMode !== 'pdf-viewport-v3' || !manifest.complete || manifest.jobId !== jobId
    || manifest.artifactSetId !== artifact.artifactSetId || manifest.sheetName !== artifact.sheetName
    || manifest.sourceSha256 !== job.source_sha256 || manifest.rendererProfileHash !== job.renderer_profile_hash) {
    throw new ApiError(409, 'Manifest 작업/원본/렌더러 정보가 일치하지 않습니다.', 'MANIFEST_IDENTITY_MISMATCH');
  }
  for (const value of [manifest.worksheetWidthPoints, manifest.worksheetHeightPoints,
    manifest.worldWidthPoints, manifest.worldHeightPoints, manifest.contentBounds?.widthPoints,
    manifest.contentBounds?.heightPoints]) {
    if (!validPositive(value)) throw new ApiError(409, 'Manifest 좌표 변환 값이 올바르지 않습니다.', 'INVALID_COORDINATE_TRANSFORM');
  }
  if (!Number.isSafeInteger(manifest.pageCount) || Number(manifest.pageCount) < 1 || manifest.pagePlacements?.length !== manifest.pageCount
    || manifest.coordinateSystem?.unit !== 'pdf-point' || manifest.coordinateSystem?.origin !== 'top-left') {
    throw new ApiError(409, 'PDF 페이지/좌표계 metadata가 올바르지 않습니다.', 'INVALID_COORDINATE_TRANSFORM');
  }
  if (manifest.pagePlacements?.some((page, index) => page.pageIndex !== index || !validPositive(page.widthPoints)
    || !validPositive(page.heightPoints) || !Number.isFinite(page.xPoints) || !Number.isFinite(page.yPoints))) {
    throw new ApiError(409, 'PDF 페이지 배치 metadata가 올바르지 않습니다.', 'INVALID_PAGE_PLACEMENT');
  }
  if (!Array.isArray(artifact.coordinates) || artifact.coordinates.length !== manifest.coordinateCount) {
    throw new ApiError(409, '좌표 개수가 Manifest와 일치하지 않습니다.', 'COORDINATE_COUNT_MISMATCH');
  }
  if (artifact.coordinates.some((item) => !item.label || !Number.isSafeInteger(item.pageIndex)
    || Number(item.pageIndex) < 0 || Number(item.pageIndex) >= Number(manifest.pageCount)
    || !Number.isFinite(item.worldXPoints) || !Number.isFinite(item.worldYPoints)
    || !Number.isFinite(item.xRatio) || !Number.isFinite(item.yRatio)
    || item.xRatio < 0 || item.xRatio > 1 || item.yRatio < 0 || item.yRatio > 1)) {
    throw new ApiError(409, '좌표 범위가 올바르지 않습니다.', 'INVALID_COORDINATES');
  }
  const coordinateHash = sha256(JSON.stringify(artifact.coordinates));
  if (coordinateHash !== manifest.coordinateHash) throw new ApiError(409, '좌표 해시가 일치하지 않습니다.', 'COORDINATE_HASH_MISMATCH');
  const manifestHash = sha256(JSON.stringify(manifest));
  if (manifestHash !== artifact.manifestSha256) throw new ApiError(409, 'Manifest SHA-256이 일치하지 않습니다.', 'MANIFEST_HASH_MISMATCH');
};

const verifyArtifactObjects = async (artifact: CompletedArtifact) => {
  const manifest = artifact.manifest;
  const prefix = `line-diagrams/v3/documents/${artifact.artifactSetId}/`;
  const required = new Set(['map.pdf', 'coordinates.json', 'manifest.json']);
  let newestNonManifest = 0;
  let manifestModified = 0;
  const result = await inspectStoredPrefix(prefix, (object) => {
    const relative = object.key.slice(prefix.length);
    if (!required.has(relative)) throw new ApiError(409, `허용되지 않은 PDF v3 객체가 있습니다: ${relative}`, 'UNEXPECTED_ARTIFACT_OBJECT');
    required.delete(relative);
    const modified = Date.parse(object.lastModified || '') || 0;
    if (relative === 'manifest.json') manifestModified = modified;
    else newestNonManifest = Math.max(newestNonManifest, modified);
  });
  if (required.size) throw new ApiError(409, `필수 artifact가 누락되었습니다: ${[...required].join(', ')}`, 'MISSING_ARTIFACT');
  if (result.count !== 3) throw new ApiError(409, 'PDF v3 artifact는 정확히 3개여야 합니다.', 'ARTIFACT_COUNT_MISMATCH');
  if (manifestModified && newestNonManifest && manifestModified < newestNonManifest) {
    throw new ApiError(409, 'manifest.json은 모든 산출물 뒤에 마지막으로 업로드해야 합니다.', 'MANIFEST_NOT_LAST');
  }
  const [manifestHead, coordinateHead, pdfHead] = await Promise.all([
    storedObjectHead(`${prefix}manifest.json`),
    storedObjectHead(`${prefix}coordinates.json`),
    storedObjectHead(`${prefix}map.pdf`),
  ]);
  if (String(manifestHead.metadata.sha256 || '') !== artifact.manifestSha256
    || String(coordinateHead.metadata.sha256 || '') !== artifact.manifest.coordinateHash
    || String(pdfHead.metadata.sha256 || '') !== artifact.manifest.files?.['map.pdf'].sha256
    || pdfHead.size !== artifact.manifest.files?.['map.pdf'].size) {
    throw new ApiError(409, 'R2 artifact 해시 메타데이터가 완료 요청과 다릅니다.', 'ARTIFACT_HASH_MISMATCH');
  }
};

export const checkpointStraightMapJobSheet = async (jobId: string, owner: string, artifact: CompletedArtifact) => {
  const job = claimedJob(jobId, owner);
  const sheet = db.prepare('SELECT artifact_set_id AS artifactSetId FROM straight_map_job_sheets WHERE job_id = ? AND sheet_name = ?')
    .get(jobId, artifact.sheetName) as { artifactSetId: string | null } | undefined;
  if (!sheet || sheet.artifactSetId !== artifact.artifactSetId) {
    throw new ApiError(409, '체크포인트 artifact가 작업 시트와 일치하지 않습니다.', 'CHECKPOINT_ARTIFACT_MISMATCH');
  }
  verifyManifestShape(jobId, job, artifact);
  await verifyArtifactObjects(artifact);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE straight_map_artifact_sets SET status = 'STAGED', manifest_sha256 = ?, coordinate_hash = ? WHERE id = ?")
      .run(artifact.manifestSha256, artifact.manifest.coordinateHash, artifact.artifactSetId);
    db.prepare(`UPDATE straight_map_job_sheets
      SET status = 'CHECKPOINT', progress = 100, checkpoint_json = ?, completed_at = CURRENT_TIMESTAMP
      WHERE job_id = ? AND sheet_name = ?`).run(JSON.stringify(artifact), jobId, artifact.sheetName);
    db.prepare(`UPDATE straight_map_jobs SET completed_sheets = (
      SELECT COUNT(*) FROM straight_map_job_sheets WHERE job_id = ? AND status IN ('CACHE_HIT', 'CHECKPOINT', 'COMPLETED')
    ) WHERE id = ?`).run(jobId, jobId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { jobId, sheetName: artifact.sheetName, status: 'CHECKPOINT' };
};

const activateArtifacts = (jobId: string, artifacts: CompletedArtifact[], cachedSheets: Array<{ sheetName: string; artifactSetId: string }>) => {
  const job = db.prepare('SELECT * FROM straight_map_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const artifact of artifacts) {
      const manifest = artifact.manifest;
      const mapKey = normalizeStationName(artifact.sheetName);
      const existingMap = db.prepare(`SELECT map_id AS mapId FROM straight_maps WHERE station_key = ? AND map_key = ?`)
        .get(String(job.station_key), mapKey) as { mapId: string } | undefined;
      const mapId = existingMap?.mapId || randomUUID();
      db.prepare(`
        INSERT INTO straight_maps (map_id, map_name, map_key, station_key, active_artifact_set_id)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(station_key, map_key) DO UPDATE SET map_name = excluded.map_name, updated_at = CURRENT_TIMESTAMP
      `).run(mapId, artifact.sheetName, mapKey, String(job.station_key));
      const prior = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM map_versions WHERE map_id = ?').get(mapId) as { version: number };
      const versionId = randomUUID();
      const version = Number(prior.version) + 1;
      db.prepare(`
        INSERT INTO map_versions (
          id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash, sheet_name,
          map_width, map_height, rendered_width, rendered_height, tile_size, max_zoom, status,
          renderer_revision, artifact_set_id, source_object_key, renderer_engine, renderer_profile, cache_key,
          manifest_object_key, coordinate_hash, rendered_dpi, render_mode, pdf_object_key, manifest_json,
          world_width_points, world_height_points, page_count, content_bounds_json, pdf_sha256
        ) VALUES (
          @id, @mapId, @mapName, @mapKey, @stationKey, @version, @originalPath, @sourceHash, @sheetName,
          @mapWidth, @mapHeight, @renderedWidth, @renderedHeight, 256, 0, 'PREPARING',
          @rendererRevision, @artifactSetId, @sourceKey, @rendererEngine, @rendererProfile, @cacheKey,
          @manifestKey, @coordinateHash, NULL, @renderMode, @pdfKey, @manifestJson,
          @worldWidth, @worldHeight, @pageCount, @contentBounds, @pdfSha256
        )
      `).run({ id: versionId, mapId, mapName: artifact.sheetName, mapKey, stationKey: String(job.station_key), version,
        originalPath: `r2://${String(job.source_key)}`, sourceHash: String(job.source_sha256), sheetName: artifact.sheetName,
        mapWidth: Math.ceil(manifest.worksheetWidthPoints), mapHeight: Math.ceil(manifest.worksheetHeightPoints),
        renderedWidth: Math.ceil(Number(manifest.worldWidthPoints)), renderedHeight: Math.ceil(Number(manifest.worldHeightPoints)),
        rendererRevision: String(job.renderer_profile_hash), artifactSetId: artifact.artifactSetId, sourceKey: String(job.source_key),
        rendererEngine: manifest.rendererEngine, rendererProfile: String(job.renderer_profile_hash),
        cacheKey: straightMapCacheKey(String(job.source_sha256), artifact.sheetName, String(job.renderer_profile_hash)),
        manifestKey: `line-diagrams/v3/documents/${artifact.artifactSetId}/manifest.json`, coordinateHash: manifest.coordinateHash,
        renderMode: manifest.renderMode, pdfKey: `line-diagrams/v3/documents/${artifact.artifactSetId}/map.pdf`,
        manifestJson: JSON.stringify(manifest), worldWidth: Number(manifest.worldWidthPoints), worldHeight: Number(manifest.worldHeightPoints),
        pageCount: Number(manifest.pageCount), contentBounds: JSON.stringify(manifest.contentBounds), pdfSha256: manifest.files?.['map.pdf'].sha256 || '' });
      const insertObject = db.prepare(`
        INSERT INTO map_objects (
          id, map_id, version_id, shape_id, shape_name, object_type, original_text, normalized_text, compact_text,
          x, y, width, height, center_x, center_y, x_ratio, y_ratio, rotation, shape_hash,
          page_index, page_x_points, page_y_points, world_x_points, world_y_points, width_points, height_points
        ) VALUES (?, ?, ?, ?, '', 'excel-shape', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (let index = 0; index < artifact.coordinates.length; index += 1) {
        const coordinate = artifact.coordinates[index];
        const x = Math.round(Number(coordinate.worldXPoints));
        const y = Math.round(Number(coordinate.worldYPoints));
        const width = Math.max(1, Math.round(coordinate.widthPoints || 1));
        const height = Math.max(1, Math.round(coordinate.heightPoints || 1));
        const shapeId = coordinate.shapeId || `coordinate-${index + 1}`;
        insertObject.run(randomUUID(), mapId, versionId, shapeId, coordinate.label, coordinate.label,
          normalizeStraightMapCompactText(coordinate.label), x, y, width, height, x, y,
          coordinate.xRatio, coordinate.yRatio, sha256(`${shapeId}:${coordinate.label}:${coordinate.worldXPoints}:${coordinate.worldYPoints}`),
          coordinate.pageIndex, coordinate.pageXPoints, coordinate.pageYPoints, coordinate.worldXPoints, coordinate.worldYPoints,
          coordinate.widthPoints || 0, coordinate.heightPoints || 0);
      }
      db.prepare("UPDATE map_versions SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE map_id = ? AND status = 'ACTIVE'").run(mapId);
      db.prepare("UPDATE map_versions SET status = 'ACTIVE', activated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PREPARING'").run(versionId);
      db.prepare('UPDATE straight_maps SET active_artifact_set_id = ?, updated_at = CURRENT_TIMESTAMP WHERE map_id = ?')
        .run(artifact.artifactSetId, mapId);
      db.prepare(`UPDATE straight_map_artifact_sets SET manifest_sha256 = ?, coordinate_hash = ?, status = 'VERIFIED', verified_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(artifact.manifestSha256, manifest.coordinateHash, artifact.artifactSetId);
      db.prepare(`UPDATE straight_map_job_sheets SET map_id = ?, status = 'COMPLETED', progress = 100, completed_at = CURRENT_TIMESTAMP WHERE job_id = ? AND sheet_name = ?`)
        .run(mapId, jobId, artifact.sheetName);
    }
    for (const cachedSheet of cachedSheets) {
      const source = db.prepare(`
        SELECT * FROM map_versions
         WHERE artifact_set_id = ? AND status IN ('ACTIVE', 'ARCHIVED')
         ORDER BY version DESC LIMIT 1
      `).get(cachedSheet.artifactSetId) as Record<string, unknown> | undefined;
      if (!source) throw new ApiError(409, '캐시 artifact의 검증된 지도 metadata를 찾을 수 없습니다.', 'CACHE_VERSION_MISSING');
      const mapKey = normalizeStationName(cachedSheet.sheetName);
      const existingMap = db.prepare('SELECT map_id AS mapId FROM straight_maps WHERE station_key = ? AND map_key = ?')
        .get(String(job.station_key), mapKey) as { mapId: string } | undefined;
      const mapId = existingMap?.mapId || randomUUID();
      db.prepare(`
        INSERT INTO straight_maps (map_id, map_name, map_key, station_key, active_artifact_set_id)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(station_key, map_key) DO UPDATE SET map_name = excluded.map_name, updated_at = CURRENT_TIMESTAMP
      `).run(mapId, cachedSheet.sheetName, mapKey, String(job.station_key));
      const prior = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM map_versions WHERE map_id = ?').get(mapId) as { version: number };
      const versionId = randomUUID();
      db.prepare(`
        INSERT INTO map_versions (
          id, map_id, map_name, map_key, station_key, version, original_file_path, source_hash, sheet_name,
          map_width, map_height, rendered_width, rendered_height, tile_size, max_zoom, status,
          renderer_revision, artifact_set_id, source_object_key, renderer_engine, renderer_profile, cache_key,
          manifest_object_key, coordinate_hash, rendered_dpi, render_mode, pdf_object_key, manifest_json,
          world_width_points, world_height_points, page_count, content_bounds_json, pdf_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 256, 0, 'PREPARING', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(versionId, mapId, cachedSheet.sheetName, mapKey, String(job.station_key), Number(prior.version) + 1,
        `r2://${String(job.source_key)}`, String(job.source_sha256), cachedSheet.sheetName,
        Number(source.map_width), Number(source.map_height), Number(source.rendered_width), Number(source.rendered_height),
        String(job.renderer_profile_hash), cachedSheet.artifactSetId, String(job.source_key),
        String(source.renderer_engine || 'windows-excel-pdf'), String(job.renderer_profile_hash),
        straightMapCacheKey(String(job.source_sha256), cachedSheet.sheetName, String(job.renderer_profile_hash)),
        String(source.manifest_object_key), String(source.coordinate_hash), String(source.render_mode), String(source.pdf_object_key),
        String(source.manifest_json), Number(source.world_width_points), Number(source.world_height_points), Number(source.page_count),
        String(source.content_bounds_json), String(source.pdf_sha256));
      const sourceObjects = db.prepare('SELECT * FROM map_objects WHERE version_id = ?').all(String(source.id)) as Array<Record<string, unknown>>;
      const insertObject = db.prepare(`
        INSERT INTO map_objects (
          id, map_id, version_id, shape_id, shape_name, object_type, original_text, normalized_text, compact_text,
          x, y, width, height, center_x, center_y, x_ratio, y_ratio, group_id, rotation, shape_hash,
          page_index, page_x_points, page_y_points, world_x_points, world_y_points, width_points, height_points
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of sourceObjects) insertObject.run(randomUUID(), mapId, versionId, String(item.shape_id), String(item.shape_name),
        String(item.object_type), String(item.original_text), String(item.normalized_text), String(item.compact_text),
        Number(item.x), Number(item.y), Number(item.width), Number(item.height), Number(item.center_x), Number(item.center_y),
        Number(item.x_ratio), Number(item.y_ratio), item.group_id === null ? null : String(item.group_id), Number(item.rotation), String(item.shape_hash),
        Number(item.page_index), Number(item.page_x_points), Number(item.page_y_points), Number(item.world_x_points), Number(item.world_y_points),
        Number(item.width_points), Number(item.height_points));
      db.prepare("UPDATE map_versions SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE map_id = ? AND status = 'ACTIVE'").run(mapId);
      db.prepare("UPDATE map_versions SET status = 'ACTIVE', activated_at = CURRENT_TIMESTAMP WHERE id = ?").run(versionId);
      db.prepare('UPDATE straight_maps SET active_artifact_set_id = ?, updated_at = CURRENT_TIMESTAMP WHERE map_id = ?').run(cachedSheet.artifactSetId, mapId);
      db.prepare("UPDATE straight_map_job_sheets SET map_id = ?, status = 'COMPLETED', progress = 100, completed_at = CURRENT_TIMESTAMP WHERE job_id = ? AND sheet_name = ?")
        .run(mapId, jobId, cachedSheet.sheetName);
    }
    db.prepare(`
      UPDATE straight_map_jobs SET status = 'COMPLETED', progress = 100, completed_sheets = total_sheets,
             current_step = '검증 및 ACTIVE 전환 완료', completed_at = CURRENT_TIMESTAMP,
             lease_owner = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL
       WHERE id = ?
    `).run(jobId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  invalidateStraightMapSearchCache();
};

export const completeStraightMapJob = async (jobId: string, owner: string, artifacts: CompletedArtifact[]) => {
  const job = db.prepare('SELECT * FROM straight_map_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!job) throw new ApiError(404, '직선도 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (job.status === 'COMPLETED') return { jobId, status: 'COMPLETED', idempotent: true };
  if (job.status === 'CANCEL_REQUESTED') {
    db.prepare("UPDATE straight_map_jobs SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?")
      .run(jobId);
    return { jobId, status: 'CANCELLED', idempotent: false };
  }
  claimedJob(jobId, owner);
  const sheets = db.prepare('SELECT sheet_name AS sheetName, status, artifact_set_id AS artifactSetId FROM straight_map_job_sheets WHERE job_id = ?').all(jobId) as Array<{ sheetName: string; status: string; artifactSetId: string | null }>;
  if (!sheets.length) throw new ApiError(409, '분석된 직선도 시트가 없습니다.', 'SHEETS_NOT_REGISTERED');
  const supplied = new Map(artifacts.map((artifact) => [artifact.sheetName, artifact]));
  const toActivate: CompletedArtifact[] = [];
  const cachedToActivate: Array<{ sheetName: string; artifactSetId: string }> = [];
  const verificationStartedAt = Date.now();
  db.prepare("UPDATE straight_map_jobs SET status = 'VERIFYING', current_step = 'R2 산출물 검증 중' WHERE id = ?").run(jobId);
  for (const sheet of sheets) {
    if (sheet.status === 'CACHE_HIT') {
      const cached = db.prepare('SELECT * FROM straight_map_artifact_sets WHERE id = ? AND status = \'VERIFIED\'').get(sheet.artifactSetId) as Record<string, unknown> | undefined;
      if (!cached) throw new ApiError(409, '캐시 artifact가 더 이상 유효하지 않습니다.', 'CACHE_ARTIFACT_MISSING');
      const prefix = `${String(cached.r2_prefix).replace(/\/$/, '')}/`;
      const requiredKeys = ['map.pdf', 'coordinates.json', 'manifest.json'];
      await Promise.all(requiredKeys.map((key) => storedObjectHead(`${prefix}${key}`)));
      cachedToActivate.push({ sheetName: sheet.sheetName, artifactSetId: String(sheet.artifactSetId) });
      continue;
    }
    const artifact = supplied.get(sheet.sheetName);
    if (!artifact || artifact.artifactSetId !== sheet.artifactSetId) throw new ApiError(409, `시트 산출물이 누락되었습니다: ${sheet.sheetName}`, 'SHEET_ARTIFACT_MISSING');
    verifyManifestShape(jobId, job, artifact);
    await verifyArtifactObjects(artifact);
    toActivate.push(artifact);
  }
  const verifyArtifactsMs = Date.now() - verificationStartedAt;
  const activationStartedAt = Date.now();
  activateArtifacts(jobId, toActivate, cachedToActivate);
  const activeTransitionMs = Date.now() - activationStartedAt;
  const completed = db.prepare('SELECT metrics_json AS metricsJson FROM straight_map_jobs WHERE id = ?').get(jobId) as { metricsJson: string };
  db.prepare('UPDATE straight_map_jobs SET metrics_json = ? WHERE id = ?').run(JSON.stringify({
    ...numericMetrics(completed.metricsJson), verifyArtifactsMs, activeTransitionMs,
  }), jobId);
  return { jobId, status: 'COMPLETED', idempotent: false, activatedSheets: toActivate.length + cachedToActivate.length };
};

export const failStraightMapJob = (jobId: string, owner: string, code: string, message: string) => {
  const existing = db.prepare('SELECT * FROM straight_map_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!existing) throw new ApiError(404, '직선도 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  if (['FAILED', 'RETRY_WAIT'].includes(String(existing.status)) && !existing.lease_owner) {
    return { jobId, status: String(existing.status), idempotent: true };
  }
  if (existing.status === 'CANCEL_REQUESTED') {
    db.prepare("UPDATE straight_map_jobs SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?")
      .run(jobId);
    return { jobId, status: 'CANCELLED', idempotent: false };
  }
  const job = claimedJob(jobId, owner);
  const retry = Number(job.attempt) < Number(job.max_attempts);
  const status = retry ? 'RETRY_WAIT' : 'FAILED';
  db.prepare(`
    UPDATE straight_map_jobs SET status = ?, error_code = ?, error_message = ?, current_step = '렌더링 실패',
           lease_owner = NULL, lease_expires_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, code.slice(0, 100), message.slice(0, 1000), jobId);
  db.prepare(`
    UPDATE straight_map_artifact_sets SET status = 'FAILED'
     WHERE id IN (SELECT artifact_set_id FROM straight_map_job_sheets WHERE job_id = ?)
       AND status = 'PREPARING'
  `).run(jobId);
  return { jobId, status, idempotent: false };
};

export const rollbackStraightMapVersion = (versionId: string) => {
  const target = db.prepare(`SELECT id, map_id AS mapId, artifact_set_id AS artifactSetId, status FROM map_versions WHERE id = ?`).get(versionId) as { id: string; mapId: string; artifactSetId: string | null; status: string } | undefined;
  if (!target || target.status !== 'ARCHIVED' || !target.artifactSetId) throw new ApiError(409, '롤백할 ARCHIVED 직선도 버전을 찾을 수 없습니다.', 'VERSION_NOT_ROLLBACKABLE');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE map_versions SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE map_id = ? AND status = 'ACTIVE'").run(target.mapId);
    db.prepare("UPDATE map_versions SET status = 'ACTIVE', activated_at = CURRENT_TIMESTAMP, archived_at = NULL WHERE id = ?").run(versionId);
    db.prepare('UPDATE straight_maps SET active_artifact_set_id = ?, updated_at = CURRENT_TIMESTAMP WHERE map_id = ?').run(target.artifactSetId, target.mapId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  invalidateStraightMapSearchCache();
  return { versionId, mapId: target.mapId, status: 'ACTIVE' };
};
