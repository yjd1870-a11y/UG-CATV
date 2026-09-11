import { Router } from 'express';
import { ApiError, asText, asyncRoute, success } from '../../http';
import { authUser } from '../../security/session';
import {
  cancelStraightMapJob,
  completeStraightMapUpload,
  createStraightMapUpload,
  deleteStraightMapJob,
  listStraightMapJobs,
  retryStraightMapJob,
  rollbackStraightMapVersion,
  storeLocalStraightMapUpload,
} from '../../straight-map-jobs';

const router = Router();

router.post('/upload-url', asyncRoute(async (req, res) => {
  const result = await createStraightMapUpload({
    sourceSha256: asText(req.body?.sourceSha256, 'sourceSha256', 64),
    filename: asText(req.body?.filename, 'filename', 255),
    size: Number(req.body?.size),
    contentType: typeof req.body?.contentType === 'string' ? req.body.contentType : '',
    stationName: asText(req.body?.stationName, 'stationName', 100),
    requestedBy: authUser(req).id,
  });
  success(res, result, 201);
}));

router.put('/local-uploads/:jobId', asyncRoute(async (req, res) => {
  const rawLength = req.get('content-length');
  const declaredLength = rawLength ? Number(rawLength) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength <= 0)) {
    throw new ApiError(400, '업로드 파일 크기를 확인할 수 없습니다.', 'INVALID_SOURCE_SIZE');
  }
  success(res, await storeLocalStraightMapUpload(req.params.jobId, authUser(req).id, req, declaredLength));
}));

router.post('/uploads/:jobId/complete', asyncRoute(async (req, res) => {
  success(res, await completeStraightMapUpload(req.params.jobId, authUser(req).id));
}));

router.get('/jobs', (_req, res) => success(res, listStraightMapJobs()));
router.post('/jobs/:jobId/retry', (req, res) => success(res, retryStraightMapJob(req.params.jobId)));
router.post('/jobs/:jobId/cancel', (req, res) => success(res, cancelStraightMapJob(req.params.jobId)));
router.delete('/jobs/:jobId', (req, res) => success(res, deleteStraightMapJob(req.params.jobId)));
router.post('/versions/:versionId/rollback', (req, res) => success(res, rollbackStraightMapVersion(req.params.versionId)));

export default router;
