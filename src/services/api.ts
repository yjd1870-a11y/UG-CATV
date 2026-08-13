// Compatibility facade. Existing imports keep working while new code should
// import directly from src/features/<feature>/api.
export { ApiClientError } from '../shared/api/client';
export { authApi } from '../features/auth/api';
export type { ApiUser, SignupInput } from '../features/auth/api';
export { cellsApi, catvApi } from '../features/cells/api';
export { transfersApi } from '../features/transfers/api';
export { dailyWorkApi, adminDailyWorkApi } from '../features/daily-work/api';
export type { DailyWorkQuery } from '../features/daily-work/api';
export { materialsApi } from '../features/materials/api';
export { noticesApi } from '../features/notices/api';
export { adminApi, adminDbApi } from '../features/admin/api';
export type {
  AdminUser,
  CellImportRecord,
  AdminCellRecord,
  AdminCellPage,
  DbUploadValidation,
  DbUploadHistory,
  AdminDbAsset,
} from '../features/admin/api';
export { loadBusinessData } from '../features/home/load-business-data';
