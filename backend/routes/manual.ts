import { Router } from 'express';
import { db } from '../db';
import { env } from '../env';
import { migrateManualSchema } from '../database/manual-schema';
import { MANUAL_LIMITS } from '../../src/features/manual/types';
import { ApiError, asyncRoute, success } from '../http';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { writeAuditLog } from '../security/audit';
import { listManualCategories, listManualModels, getManualModel, listManualAssets, saveManualCategory, saveManualModel,
  saveManualText, saveManualModelImage, reserveManualUpload, editManualAsset, deleteManualAssetRecord, deleteManualModel, deleteManualCategory } from '../manual-service';
import { purgeManualStorage, receiveManualUpload, serveManualAsset } from '../manual-storage';

const router = Router();
router.use(requireAuth);
router.use((req, _res, next) => {
  if (env.isProduction && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = (req.get('origin') || '').replace(/\/$/, '');
    if (!origin || !env.adminMutationAllowedOrigins.has(origin)) { next(new ApiError(403, '이 배포 환경에서는 매뉴얼을 변경할 수 없습니다.', 'ADMIN_ORIGIN_FORBIDDEN')); return; }
  }
  next();
});
const manage = requireRoles('admin');
const audit = (req: Parameters<typeof writeAuditLog>[0], action: string, id: string) => writeAuditLog(req, { action, targetType: 'manual', targetId: id });
export const initializeManualModule = () => {
  migrateManualSchema(db);
  void purgeManualStorage().catch((error) => console.error('[MANUAL_PURGE_FAILED]', error));
};
const timer = setInterval(() => { void purgeManualStorage().catch((error) => console.error('[MANUAL_PURGE_FAILED]', error)); }, 10 * 60 * 1000);
timer.unref();
router.get('/categories', (req, res) => success(res, { items: listManualCategories(), canManage: authUser(req).role === 'admin', limits: MANUAL_LIMITS }));
router.post('/categories', manage, (req, res) => { const result = saveManualCategory(null, req.body || {}); audit(req, 'MANUAL_CATEGORY_CREATE', result.id); success(res, result, 201); });
router.put('/categories/:id', manage, (req, res) => { const result = saveManualCategory(req.params.id, req.body || {}); audit(req, 'MANUAL_CATEGORY_UPDATE', result.id); success(res, result); });
router.delete('/categories/:id', manage, (req, res) => { deleteManualCategory(req.params.id); audit(req, 'MANUAL_CATEGORY_DELETE', req.params.id); success(res, { deleted: true }); });
router.get('/categories/:id/models', (req, res) => success(res, listManualModels(req.params.id)));
router.post('/models', manage, (req, res) => { const model = saveManualModel(null, req.body || {}); audit(req, 'MANUAL_MODEL_CREATE', model.id); success(res, model, 201); });
router.get('/models/:id', (req, res) => success(res, { model: getManualModel(req.params.id), assets: listManualAssets(req.params.id), canManage: authUser(req).role === 'admin' }));
router.put('/models/:id', manage, (req, res) => { const model = saveManualModel(req.params.id, req.body || {}); audit(req, 'MANUAL_MODEL_UPDATE', model.id); success(res, model); });
router.put('/models/:id/text', manage, (req, res) => { const model = saveManualText(req.params.id, req.body || {}); audit(req, 'MANUAL_TEXT_UPDATE', model.id); success(res, model); });
router.put('/models/:id/image', manage, asyncRoute(async (req, res) => { const model = saveManualModelImage(req.params.id, req.body?.assetId); await purgeManualStorage(); audit(req, 'MANUAL_MODEL_IMAGE_UPDATE', model.id); success(res, model); }));
router.delete('/models/:id', manage, asyncRoute(async (req, res) => { deleteManualModel(req.params.id); await purgeManualStorage(); audit(req, 'MANUAL_MODEL_DELETE', req.params.id); success(res, { deleted: true }); }));
router.post('/models/:id/uploads', manage, asyncRoute(async (req, res) => {
  await purgeManualStorage(); const result = reserveManualUpload(req.params.id, req.body || {}, authUser(req).id); success(res, result, 201);
}));
router.put('/assets/:id/upload', manage, asyncRoute(async (req, res) => { await receiveManualUpload(req, req.params.id, authUser(req).id); audit(req, 'MANUAL_ASSET_UPLOAD', req.params.id); success(res, { uploaded: true }); }));
router.patch('/assets/:id', manage, (req, res) => { editManualAsset(req.params.id, req.body || {}); audit(req, 'MANUAL_ASSET_UPDATE', req.params.id); success(res, { updated: true }); });
router.delete('/assets/:id', manage, asyncRoute(async (req, res) => { deleteManualAssetRecord(req.params.id); await purgeManualStorage(); audit(req, 'MANUAL_ASSET_DELETE', req.params.id); success(res, { deleted: true }); }));
router.get('/assets/:id/content', asyncRoute(async (req, res) => { await serveManualAsset(req.params.id, req, res); }));
export default router;
