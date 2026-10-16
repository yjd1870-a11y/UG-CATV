import express, { Router } from 'express';
import fs from 'node:fs/promises';
import { env } from '../env';
import { ApiError, asyncRoute, success } from '../http';
import { authUser, requireAuth, requireRoles } from '../security/session';
import { writeAuditLog } from '../security/audit';
import { signedR2DownloadUrl, usesR2Storage } from '../object-storage';
import { initializeCcParticipation, readCcParticipation, saveCcParticipation, storeCcPhoto, discardCcPhoto, purgeCcPhotos, getCcPhoto, ccPhotoIsLinked, ccPhotoPath } from '../cc-participation-service';

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (env.isProduction && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !env.adminMutationAllowedOrigins.has((req.get('origin') || '').replace(/\/$/, ''))) return next(new ApiError(403, '이 환경에서는 CC 참여 자료를 변경할 수 없습니다.', 'ADMIN_ORIGIN_FORBIDDEN'));
  next();
});
export const initializeCcParticipationModule = () => {
  initializeCcParticipation();
  void purgeCcPhotos().catch((error) => console.error('[CC_PHOTO_PURGE_FAILED]', error));
};
const timer = setInterval(() => void purgeCcPhotos().catch((error) => console.error('[CC_PHOTO_PURGE_FAILED]', error)), 60 * 60 * 1000);
timer.unref();
router.get('/', (req, res) => success(res, readCcParticipation(authUser(req).role === 'admin')));
router.put('/', requireRoles('admin'), asyncRoute(async (req, res) => {
  const doc = saveCcParticipation(req.body || {}, authUser(req).id);
  writeAuditLog(req, { action: 'CC_PARTICIPATION_UPDATE', targetType: 'cc_participation', targetId: '1' });
  await purgeCcPhotos();
  success(res, doc);
}));
router.post('/photos', requireRoles('admin'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '10mb' }), asyncRoute(async (req, res) => {
  await purgeCcPhotos();
  const photo = await storeCcPhoto(req.body, req.get('content-type')?.split(';')[0] || '', authUser(req).id);
  writeAuditLog(req, { action: 'CC_PARTICIPATION_PHOTO_UPLOAD', targetType: 'cc_participation_photo', targetId: photo.id });
  success(res, photo, 201);
}));
router.delete('/photos/:id', requireRoles('admin'), asyncRoute(async (req, res) => {
  discardCcPhoto(req.params.id, authUser(req).id); await purgeCcPhotos(); success(res, { deleted: true });
}));
router.get('/photos/:id', asyncRoute(async (req, res) => {
  const photo = getCcPhoto(req.params.id);
  const user = authUser(req);
  if (!ccPhotoIsLinked(photo.id) && !(user.role === 'admin' && photo.uploaded_by === user.id)) throw new ApiError(404, '사진을 찾을 수 없습니다.');
  if (usesR2Storage) { res.redirect(302, await signedR2DownloadUrl(photo.object_key, { fileName: 'cc-participation.webp', attachment: false })); return; }
  const location = ccPhotoPath(photo.object_key);
  if (!(await fs.stat(location).catch(() => null))) throw new ApiError(404, '사진 파일을 찾을 수 없습니다.');
  res.type('image/webp').sendFile(location);
}));
export default router;
