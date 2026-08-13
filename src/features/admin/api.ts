import type { ApiUser } from '../auth/api';
import { request } from '../../shared/api/client';

export type AdminUser = ApiUser & {
  zone: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  passwordUpdatedAt: string | null;
  passwordConfigured: boolean | number;
};

export type CellImportRecord = {
  keyNumber: string;
  cellName: string;
  stationName: string;
  stationAddress: string;
  otxNode: string;
  otxLineNumber: string;
  orxNode: string;
  orxLineNumber: string;
  spareNode: string;
  spareLineNumber: string;
  otxRack: string;
  otxShelf: string;
  otxPort: string;
  otxModel: string;
  orxRack: string;
  orxShelf: string;
  orxPort: string;
  orxModel: string;
  onuLocation: string;
  onuPhoto: string;
  onuPhotoList: string;
  onuManufacturer: string;
  onuModel: string;
  onuDivision: string;
  onuCellConfig: string;
  upsLocation: string;
  upsPhoto: string;
  upsPhotoList: string;
  upsManufacturer: string;
  upsModel: string;
  notes: string;
  [key: string]: unknown;
};

export type AdminCellRecord = CellImportRecord & { id: string; status: string; updatedAt: string };
export type AdminCellPage = { items: AdminCellRecord[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
export type DbUploadValidation = { valid: true; validationId: string; recordCount: number; currentCount: number; newCount: number; updatedCount: number; deletedCount: number };
export type DbUploadHistory = {
  id: string;
  dbType: 'cell' | 'floor_plan' | 'b2c';
  fileName: string;
  fileSize: number;
  recordCount: number;
  newCount: number;
  updatedCount: number;
  deletedCount: number;
  uploadedBy: string;
  uploadedAt: string;
  status: 'success' | 'failed';
  message?: string | null;
};
export type AdminDbAsset = {
  id: string;
  dbType: 'floor_plan' | 'b2c';
  stationName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  recordCount: number;
  coordinatesJson: string;
  imageUrl?: string | null;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
};

export const adminApi = {
  users: (status?: 'pending' | 'active' | 'disabled') => request<AdminUser[]>(`/admin/users${status ? `?status=${status}` : ''}`),
  approve: (id: string) => request<{ id: string; status: 'active' }>(`/admin/users/${encodeURIComponent(id)}/approve`, { method: 'PUT' }),
  disable: (id: string) => request<{ id: string; status: 'disabled' }>(`/admin/users/${encodeURIComponent(id)}/disable`, { method: 'PUT' }),
  enable: (id: string) => request<{ id: string; status: 'active' }>(`/admin/users/${encodeURIComponent(id)}/enable`, { method: 'PUT' }),
  create: (input: { username: string; zone: string; name: string; role: ApiUser['role']; password: string }) =>
    request<{ id: string }>('/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  updateRole: (id: string, role: ApiUser['role']) => request<{ id: string; role: ApiUser['role'] }>(`/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PUT', body: JSON.stringify({ role }),
  }),
  resetPassword: (id: string, password: string) => request<{ id: string }>(`/admin/users/${encodeURIComponent(id)}/password`, {
    method: 'PUT', body: JSON.stringify({ password }),
  }),
  remove: (id: string) => request<{ id: string; deleted: true }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const adminDbApi = {
  status: () => request<{ storage: 'sqlite'; counts: { accounts: number; cells: number; floorPlans: number; b2c: number } }>('/admin/db/status'),
  cells: (query = '', page = 1, limit = 100) => request<AdminCellPage>(`/admin/db/cells?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`),
  validateCells: (input: { fileName: string; fileSize: number; mimeType: string; records: CellImportRecord[] }) =>
    request<DbUploadValidation>('/admin/db/validate', { method: 'POST', body: JSON.stringify(input) }),
  uploadCells: (validationId: string) => request<{ uploaded: true; history: DbUploadHistory }>('/admin/db/upload', {
    method: 'POST', body: JSON.stringify({ validationId }),
  }),
  clearCells: () => request<{ deletedCount: number }>('/admin/db/cells', { method: 'DELETE' }),
  history: () => request<DbUploadHistory[]>('/admin/db/history'),
  assets: (type: 'floor_plan' | 'b2c') => request<AdminDbAsset[]>(`/admin/db/assets?type=${type}`),
  saveAsset: (input: {
    dbType: 'floor_plan' | 'b2c'; stationName: string; fileName: string; fileSize: number; mimeType?: string;
    records?: Array<Record<string, unknown>>; coordinates?: Record<string, unknown>; fileBase64?: string;
  }) => request<{ id: string; straightMap?: { mapCount: number; objectCount: number; changedCount: number; reusedMapCount?: number; status: string } | null; straightMapError?: string | null }>('/admin/db/assets', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateAsset: (id: string, input: {
    stationName: string; fileName?: string; fileSize?: number; mimeType?: string;
    records?: Array<Record<string, unknown>>; coordinates: Record<string, unknown>;
  }) => request<{ id: string; updated: true }>(`/admin/db/assets/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  deleteAsset: (id: string) => request<{ id: string; deleted: true }>(`/admin/db/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearAssets: (type: 'floor_plan' | 'b2c') => request<{ deletedCount: number }>(`/admin/db/assets?type=${type}`, { method: 'DELETE' }),
};
