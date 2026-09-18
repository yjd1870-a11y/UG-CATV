import type { MaterialUsageRecord } from '../../types';
import { request } from '../../shared/api/client';
import { downloadFile } from '../../shared/api/client';

export type InventoryPermissions = {
  canOperate: boolean;
  canManage: boolean;
  canFieldUse: boolean;
  canStationUse: boolean;
  canViewMaster: boolean;
  canImportExcel: boolean;
  canExportExcel: boolean;
};
export type InventoryWorker = { id: string; name: string; regionId?: string; regionName?: string };
export type FieldMaterialCategory = { id: string; categoryName: string; sortOrder: number; active: number };
export type FieldMaterialModel = { id: string; categoryId: string; categoryName: string; modelName: string; manufacturer: string; unit: string; materialKind: 'ACTIVE' | 'PASSIVE'; notes: string; active: number };
export type FieldBalance = Omit<FieldMaterialModel, 'id'> & { modelId: string; normalQuantity: number; badQuantity: number };
export type SpareStation = { id: string; regionName: string; stationName: string; normalizedKey: string; sortOrder: number; active: number };
export type SpareModel = { id: string; manufacturer: string; itemType: string; modelName: string; unit: string; notes: string; active: number };
export type SpareBalance = Omit<SpareModel, 'id'> & { modelId: string; stationId: string; regionName: string; stationName: string; newQuantity: number; serviceableQuantity: number; defectiveQuantity: number; inRepairQuantity: number };
export type InventoryTransaction = { id: string; transactionNumber: string; domain: 'FIELD' | 'STATION'; transactionType: string; effectiveDate: string; status: string; quantity: number; modelId?: string; stockState?: string; categoryName?: string; modelName: string; purpose?: string; workDetails?: string; companyName?: string; location?: string; regionId?: string; regionName?: string; createdByName: string; workerName?: string; sourceStationName?: string; destinationStationName?: string; createdAt: string };
export type InventoryStatisticRow = { label: string; quantity: number; count: number };
export type FieldUsageStatistics = {
  start: string;
  end: string;
  totals: { totalQuantity: number; fieldUseQuantity: number; issueQuantity: number; transactionCount: number; workerCount: number };
  byRegion: InventoryStatisticRow[];
  byWorker: InventoryStatisticRow[];
};
export type FieldUsageItemStatistic = { categoryName: string; modelName: string; quantity: number; count: number };
export type FieldIssueDetail = { id: string; effectiveDate: string; releasePlace: string; issueType: string; categoryName: string; modelName: string; quantity: number };
export type FieldStatisticFilters = { regionName?: string; categoryName?: string; modelName?: string; workerName?: string; issueOnly?: boolean };
export type FieldStatisticMeta = { regions: Array<{id:string;name:string}>; workers: Array<{name:string;regionName:string}> };
const fieldStatisticQuery = (start: string, end: string, filters: FieldStatisticFilters = {}) => {
  const query = new URLSearchParams({ start, end });
  if (filters.regionName) query.set('region', filters.regionName);
  if (filters.categoryName) query.set('category', filters.categoryName);
  if (filters.modelName) query.set('model', filters.modelName);
  if (filters.workerName) query.set('worker', filters.workerName);
  if (filters.issueOnly) query.set('issuesOnly', '1');
  return query.toString();
};
export type InventoryBootstrap = {
  permissions: InventoryPermissions;
  workers: InventoryWorker[];
  categories: FieldMaterialCategory[];
  fieldModels: FieldMaterialModel[];
  fieldBalances: FieldBalance[];
  fieldTransactions: InventoryTransaction[];
  stations: SpareStation[];
  spareModels: SpareModel[];
  stationBalances: SpareBalance[];
  stationTransactions: InventoryTransaction[];
  closures: Array<{ id: string; periodKey: string; periodStart: string; periodEnd: string; status: string; confirmedAt: string }>;
};

export type InventoryTransactionInput = {
  transactionType: string;
  effectiveDate: string;
  modelId: string;
  quantity: number;
  stockState?: string;
  fromState?: string;
  stationId?: string;
  sourceStationId?: string;
  destinationStationId?: string;
  cellId?: string;
  regionId?: string;
  location?: string;
  workCategory?: string;
  sourceWorkerName?: string;
  sourceWorkerId?: string;
  purpose?: string;
  workDetails?: string;
  companyName?: string;
  vendorName?: string;
  reason?: string;
  memo?: string;
  direction?: number;
  beforePhoto?: string;
  afterPhoto?: string;
  idempotencyKey: string;
};
export type FieldBatchTransactionInput = Omit<InventoryTransactionInput, 'transactionType' | 'modelId' | 'quantity'> & {
  items: Array<Pick<InventoryTransactionInput, 'transactionType' | 'modelId' | 'quantity' | 'stockState' | 'companyName' | 'idempotencyKey'>>;
};
export type SpareBatchTransactionInput = Omit<InventoryTransactionInput, 'transactionType' | 'modelId' | 'quantity'> & {
  items: Array<Pick<InventoryTransactionInput, 'transactionType' | 'modelId' | 'quantity' | 'stockState' | 'fromState' | 'idempotencyKey'>>;
};
export type FieldTransactionUpdateInput = Pick<InventoryTransactionInput, 'transactionType' | 'effectiveDate' | 'modelId' | 'quantity'> & {
  stockState?: string;
  direction?: number;
  regionId?: string;
  location: string;
  purpose?: string;
  workDetails?: string;
  companyName?: string;
  reason: string;
};

export const materialsApi = {
  list: () => request<Array<Record<string, unknown>>>('/materials'),
  usage: () => request<MaterialUsageRecord[]>('/material-usage'),
  addUsage: (input: Omit<MaterialUsageRecord, 'id' | 'createdAt' | 'workerName'>) =>
    request<MaterialUsageRecord>('/material-usage', { method: 'POST', body: JSON.stringify(input) }),
};

export const inventoryApi = {
  bootstrap: () => request<InventoryBootstrap>('/material-management/bootstrap'),
  fieldStatisticsMeta: () => request<FieldStatisticMeta>('/material-management/field/statistics/meta'),
  fieldStatistics: (start: string, end: string, filters: FieldStatisticFilters = {}) => request<FieldUsageStatistics>(`/material-management/field/statistics?${fieldStatisticQuery(start, end, filters)}`),
  fieldItemStatistics: (start: string, end: string, group: 'ALL' | 'WORKER' | 'TEAM', value = '', filters: FieldStatisticFilters = {}) => request<FieldUsageItemStatistic[]>(`/material-management/field/statistics/items?${fieldStatisticQuery(start, end, filters)}&group=${group}&value=${encodeURIComponent(value)}`),
  fieldIssueDetails: (start: string, end: string, group: 'ALL' | 'WORKER' | 'TEAM', value = '', filters: FieldStatisticFilters = {}) => request<FieldIssueDetail[]>(`/material-management/field/statistics/issues?${fieldStatisticQuery(start, end, filters)}&group=${group}&value=${encodeURIComponent(value)}`),
  addFieldTransaction: (input: InventoryTransactionInput) => request('/material-management/field/transactions', { method: 'POST', body: JSON.stringify(input) }),
  addFieldTransactions: (input: FieldBatchTransactionInput) => request<{ count: number }>('/material-management/field/transactions/batch', { method: 'POST', body: JSON.stringify(input) }),
  addStationTransaction: (input: InventoryTransactionInput) => request('/material-management/station/transactions', { method: 'POST', body: JSON.stringify(input) }),
  addStationTransactions: (input: SpareBatchTransactionInput) => request<{ count: number }>('/material-management/station/transactions/batch', { method: 'POST', body: JSON.stringify(input) }),
  reverse: (id: string, reason: string) => request(`/material-management/transactions/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  updateFieldTransaction: (id: string, input: FieldTransactionUpdateInput) => request(`/material-management/field/transactions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  updateFieldQuantity: (id: string, quantity: number, reason: string) => request(`/material-management/field/transactions/${encodeURIComponent(id)}/quantity`, { method: 'PUT', body: JSON.stringify({ quantity, reason }) }),
  deleteFieldTransaction: (id: string, reason: string) => request(`/material-management/field/transactions/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  addFieldModel: (input: { categoryId?: string; categoryName?: string; modelName: string; quantity: number; unit: string; materialKind: 'ACTIVE' | 'PASSIVE'; notes?: string }) => request('/material-management/field/models', { method: 'POST', body: JSON.stringify(input) }),
  updateFieldModel: (id: string, input: { categoryId?: string; categoryName?: string; modelName: string; unit: string; materialKind: 'ACTIVE' | 'PASSIVE'; notes?: string; active?: boolean }) => request(`/material-management/field/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteFieldModel: (id: string) => request(`/material-management/field/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addSpareModel: (input: { manufacturer: string; itemType: string; modelName: string; unit: string; notes?: string }) => request('/material-management/station/models', { method: 'POST', body: JSON.stringify(input) }),
  updateSpareModel: (id: string, input: { manufacturer: string; itemType: string; modelName: string; unit: string; notes?: string; active?: boolean }) => request(`/material-management/station/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteSpareModel: (id: string) => request(`/material-management/station/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  closeMonth: (periodKey: string) => request('/material-management/field/closures', { method: 'POST', body: JSON.stringify({ periodKey }) }),
  stageImport: (input: { domain: 'FIELD' | 'STATION'; sourceFile: string; sourceHash?: string; sheetName?: string; rows: Array<Record<string, unknown>> }) => request<{ sourceHash: string; inserted: number; review: number }>('/material-management/imports/stage', { method: 'POST', body: JSON.stringify(input) }),
  importOfficialField: (input: { sourceFile: string; sourceHash: string; sourceWorkbookBase64?: string; reportYear?: number; rows: Array<Record<string, unknown>> }) => request<{ inserted: number; skipped: number }>('/material-management/field/imports/official', { method: 'POST', body: JSON.stringify(input) }),
  importStationInventory: (input: { sourceFile: string; sourceHash: string; rows: Array<Record<string, unknown>> }) => request<{ inserted: number; skipped: number }>('/material-management/station/imports/inventory', { method: 'POST', body: JSON.stringify(input) }),
  downloadFieldOfficial: (year: number) => downloadFile(`/material-management/exports/field-official.xlsx?year=${year}`, `CATV_현장자재_공식보고_${year}.xlsx`),
  downloadFieldPhotos: (start: string, end: string) => downloadFile(`/material-management/exports/field-photos.xlsx?start=${start}&end=${end}`, `CATV_능동자재_사진_${start}_${end}.xlsx`),
  downloadHs: (start: string, end: string) => downloadFile(`/material-management/exports/hs.xlsx?start=${start}&end=${end}`, `CATV_HS분출_${start}_${end}.xlsx`),
  downloadStation: (asOf: string) => downloadFile(`/material-management/exports/station.xlsx?asOf=${asOf}`, `CATV_국사예비품_${asOf}.xlsx`),
};

export const compressInventoryPhoto = async (file: File): Promise<string> => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진만 등록할 수 있습니다.');
  if (file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하여야 합니다.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사진을 처리할 수 없습니다.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
};
