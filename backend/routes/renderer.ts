import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { env } from '../env';
import { ApiError, asText, asyncRoute, success } from '../http';
import {
  claimStraightMapJob,
  checkpointStraightMapJobSheet,
  completeStraightMapJob,
  createArtifactUploadUrls,
  createStraightMapSourceRepairUploadUrl,
  failStraightMapJob,
  heartbeatStraightMapJob,
  localStraightMapSourceFile,
  progressStraightMapJob,
  registerStraightMapJobSheets,
  resumeStraightMapJobForSourceRepair,
  straightMapRendererProfile,
  straightMapRendererProfileHash,
  straightMapSourceDownload,
  storeLocalStraightMapArtifact,
} from '../straight-map-jobs';

const router = Router();

const rendererAuth: RequestHandler = (req, _res, next) => {
  if (!env.straightMapPipelineV3Enabled) {
    next(new ApiError(409, '직선도 렌더러 파이프라인이 비활성화되어 있습니다.', 'STRAIGHT_MAP_V3_DISABLED'));
    return;
  }
  if (Buffer.byteLength(env.straightMapRendererDeviceToken, 'utf8') < 32) {
    next(new ApiError(503, '렌더러 device token이 아직 설정되지 않았습니다.', 'RENDERER_NOT_CONFIGURED'));
    return;
  }
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expected = createHash('sha256').update(env.straightMapRendererDeviceToken).digest();
  const actual = createHash('sha256').update(token).digest();
  if (!token || !timingSafeEqual(actual, expected)) {
    next(new ApiError(401, '렌더러 device token이 올바르지 않습니다.', 'RENDERER_AUTH_FAILED'));
    return;
  }
  next();
};

router.use(rendererAuth);

const owner = (body: unknown) => asText((body as Record<string, unknown> | undefined)?.rendererId, 'rendererId', 120);

router.post('/session', (req, res) => {
  const rendererId = owner(req.body);
  success(res, {
    rendererId,
    profile: straightMapRendererProfile(),
    rendererProfileHash: straightMapRendererProfileHash(),
    heartbeatSeconds: 30,
    leaseSeconds: env.straightMapLeaseSeconds,
    maxUploadBatch: 500,
  });
});

router.post('/jobs/claim', (req, res) => success(res, { job: claimStraightMapJob(owner(req.body)) }));

router.post('/jobs/:jobId/source-repair-resume', (req, res) => {
  owner(req.body);
  success(res, resumeStraightMapJobForSourceRepair(
    req.params.jobId,
    asText(req.body?.sourceSha256, 'sourceSha256', 64),
  ));
});

router.post('/jobs/:jobId/source-url', asyncRoute(async (req, res) => {
  success(res, await straightMapSourceDownload(req.params.jobId, owner(req.body)));
}));

router.post('/jobs/:jobId/source-upload-url', asyncRoute(async (req, res) => {
  success(res, await createStraightMapSourceRepairUploadUrl(req.params.jobId, owner(req.body)));
}));

router.get('/jobs/:jobId/source', (req, res) => {
  const rendererId = asText(req.query.rendererId, 'rendererId', 120);
  const filePath = localStraightMapSourceFile(req.params.jobId, rendererId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

router.post('/jobs/:jobId/heartbeat', (req, res) => {
  success(res, heartbeatStraightMapJob(req.params.jobId, owner(req.body)));
});

router.post('/jobs/:jobId/progress', (req, res) => {
  success(res, progressStraightMapJob(req.params.jobId, owner(req.body), {
    status: asText(req.body?.status, 'status', 50),
    progress: Number(req.body?.progress),
    currentSheet: typeof req.body?.currentSheet === 'string' ? req.body.currentSheet : undefined,
    currentStep: typeof req.body?.currentStep === 'string' ? req.body.currentStep : undefined,
    metrics: req.body?.metrics && typeof req.body.metrics === 'object' ? req.body.metrics : undefined,
    tileCount: Number(req.body?.tileCount || 0),
    artifactBytes: Number(req.body?.artifactBytes || 0),
  }));
});

router.post('/jobs/:jobId/sheets', (req, res) => {
  if (!Array.isArray(req.body?.sheetNames)) throw new ApiError(400, 'sheetNames 배열이 필요합니다.', 'INVALID_SHEETS');
  success(res, { sheets: registerStraightMapJobSheets(
    req.params.jobId, owner(req.body), req.body.sheetNames,
    req.body?.sheetHashes && typeof req.body.sheetHashes === 'object' ? req.body.sheetHashes : {},
  ) });
});

router.post('/jobs/:jobId/artifacts/upload-urls', asyncRoute(async (req, res) => {
  success(res, await createArtifactUploadUrls(req.params.jobId, owner(req.body), {
    sheetName: asText(req.body?.sheetName, 'sheetName', 255),
    artifactSetId: typeof req.body?.artifactSetId === 'string' ? req.body.artifactSetId : undefined,
    files: req.body?.files,
  }));
}));

router.put('/jobs/:jobId/artifacts/:artifactSetId', asyncRoute(async (req, res) => {
  if (!req.is('application/octet-stream')) throw new ApiError(415, '로컬 artifact는 octet-stream으로 업로드해야 합니다.', 'INVALID_ARTIFACT_CONTENT_TYPE');
  const rawLength = req.get('content-length');
  const declaredLength = rawLength ? Number(rawLength) : null;
  success(res, await storeLocalStraightMapArtifact({
    jobId: req.params.jobId,
    owner: asText(req.query.rendererId, 'rendererId', 120),
    artifactSetId: req.params.artifactSetId,
    relativeKey: asText(req.query.relativeKey, 'relativeKey', 500),
    expectedSize: Number(req.query.size),
    expectedSha256: asText(req.query.sha256, 'sha256', 64),
    declaredLength,
    body: req,
  }));
}));

router.post('/jobs/:jobId/complete', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.artifacts)) throw new ApiError(400, 'artifacts 배열이 필요합니다.', 'INVALID_ARTIFACTS');
  success(res, await completeStraightMapJob(req.params.jobId, owner(req.body), req.body.artifacts));
}));

router.post('/jobs/:jobId/sheets/checkpoint', asyncRoute(async (req, res) => {
  if (!req.body?.artifact || typeof req.body.artifact !== 'object') throw new ApiError(400, '체크포인트 artifact가 필요합니다.', 'INVALID_CHECKPOINT');
  success(res, await checkpointStraightMapJobSheet(req.params.jobId, owner(req.body), req.body.artifact));
}));

router.post('/jobs/:jobId/fail', (req, res) => {
  success(res, failStraightMapJob(
    req.params.jobId,
    owner(req.body),
    asText(req.body?.errorCode, 'errorCode', 100),
    asText(req.body?.errorMessage, 'errorMessage', 1000),
  ));
});

export default router;
