import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { env } from '../env';
import { ApiError, asText, asyncRoute, success } from '../http';
import {
  claimStraightMapJob,
  completeStraightMapJob,
  createArtifactUploadUrls,
  failStraightMapJob,
  heartbeatStraightMapJob,
  progressStraightMapJob,
  registerStraightMapJobSheets,
  straightMapRendererProfile,
  straightMapRendererProfileHash,
  straightMapSourceDownload,
} from '../straight-map-jobs';

const router = Router();

const rendererAuth: RequestHandler = (req, _res, next) => {
  if (!env.straightMapPipelineV2Enabled) {
    next(new ApiError(409, '직선도 렌더러 파이프라인이 비활성화되어 있습니다.', 'STRAIGHT_MAP_V2_DISABLED'));
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

router.post('/jobs/:jobId/source-url', asyncRoute(async (req, res) => {
  success(res, await straightMapSourceDownload(req.params.jobId, owner(req.body)));
}));

router.post('/jobs/:jobId/heartbeat', (req, res) => {
  success(res, heartbeatStraightMapJob(req.params.jobId, owner(req.body)));
});

router.post('/jobs/:jobId/progress', (req, res) => {
  success(res, progressStraightMapJob(req.params.jobId, owner(req.body), {
    status: asText(req.body?.status, 'status', 50),
    progress: Number(req.body?.progress),
    currentSheet: typeof req.body?.currentSheet === 'string' ? req.body.currentSheet : undefined,
    currentStep: typeof req.body?.currentStep === 'string' ? req.body.currentStep : undefined,
  }));
});

router.post('/jobs/:jobId/sheets', (req, res) => {
  if (!Array.isArray(req.body?.sheetNames)) throw new ApiError(400, 'sheetNames 배열이 필요합니다.', 'INVALID_SHEETS');
  success(res, { sheets: registerStraightMapJobSheets(req.params.jobId, owner(req.body), req.body.sheetNames) });
});

router.post('/jobs/:jobId/artifacts/upload-urls', asyncRoute(async (req, res) => {
  success(res, await createArtifactUploadUrls(req.params.jobId, owner(req.body), {
    sheetName: asText(req.body?.sheetName, 'sheetName', 255),
    artifactSetId: typeof req.body?.artifactSetId === 'string' ? req.body.artifactSetId : undefined,
    files: req.body?.files,
  }));
}));

router.post('/jobs/:jobId/complete', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.artifacts)) throw new ApiError(400, 'artifacts 배열이 필요합니다.', 'INVALID_ARTIFACTS');
  success(res, await completeStraightMapJob(req.params.jobId, owner(req.body), req.body.artifacts));
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
