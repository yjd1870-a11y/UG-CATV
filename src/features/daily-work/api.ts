import type { DailyWorkAggregate, DailyWorkMeta, DailyWorkRecord, WorkCategory } from '../../types';
import { downloadFile, request } from '../../shared/api/client';

export type DailyWorkQuery = {
  from?: string;
  to?: string;
  year?: string;
  month?: string;
  userId?: string;
  regionId?: string;
  categoryId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

const queryString = (query: DailyWorkQuery & { mode?: string }) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
};

export const dailyWorkApi = {
  list: () => request<DailyWorkRecord[]>('/daily-work'),
  meta: () => request<DailyWorkMeta>('/daily-work/meta'),
  my: (query = '') => request<DailyWorkAggregate>(`/daily-work/my${query ? `?${query}` : ''}`),
  detail: (id: string) => request<DailyWorkRecord>(`/daily-work/${encodeURIComponent(id)}`),
  find: (date: string, userId?: string) => {
    const params = new URLSearchParams({ date });
    if (userId) params.set('userId', userId);
    return request<DailyWorkRecord | null>(`/daily-work/record?${params.toString()}`);
  },
  save: (input: { date: string; counts: Record<string, number>; memo?: string; cellId?: string; userId?: string; updatedAt?: string }) =>
    request<DailyWorkRecord>('/daily-work', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: { date?: string; counts: Record<string, number>; memo?: string; updatedAt?: string }) =>
    request<DailyWorkRecord>(`/daily-work/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  history: (id: string) => request<Array<Record<string, unknown>>>(`/daily-work/${encodeURIComponent(id)}/history`),
  remove: (id: string, reason?: string) => request<{ id: string; deleted: boolean; hardDeleted: boolean }>(`/daily-work/${encodeURIComponent(id)}`, {
    method: 'DELETE', body: JSON.stringify({ reason }),
  }),
  export: (query: DailyWorkQuery) => downloadFile(`/daily-work/export?${queryString(query)}`, '전송망_일일업무.xlsx'),
};

export const adminDailyWorkApi = {
  meta: () => request<DailyWorkMeta>('/admin/daily-work/meta'),
  summary: () => request<{ today: string; todayTotal: number; monthTotal: number; enteredUsers: number; missingUsers: number }>('/admin/daily-work/summary'),
  query: (mode: 'person' | 'region' | 'month' | 'period', query: DailyWorkQuery) =>
    request<DailyWorkAggregate>(`/admin/daily-work/${mode}?${queryString(query)}`),
  detail: (id: string) => request<DailyWorkRecord>(`/admin/daily-work/detail/${encodeURIComponent(id)}`),
  drilldown: (query: DailyWorkQuery) => request<DailyWorkAggregate>(`/admin/daily-work/drilldown?${queryString(query)}`),
  export: (mode: 'person' | 'region' | 'month' | 'period', query: DailyWorkQuery) =>
    downloadFile(`/admin/daily-work/export?${queryString({ ...query, mode })}`, '전송망_일일업무.xlsx'),
  categories: () => request<WorkCategory[]>('/admin/daily-work/categories'),
  createCategory: (name: string) => request<WorkCategory>('/admin/daily-work/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  updateCategory: (id: string, input: { name: string; sortOrder: number; active: boolean }) =>
    request<WorkCategory>(`/admin/daily-work/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
};
