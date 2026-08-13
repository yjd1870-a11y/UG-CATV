import type { HomeNotice } from '../../types';
import { request } from '../../shared/api/client';

export const noticesApi = {
  list: () => request<HomeNotice[]>('/notices'),
  create: (input: { title: string; content: string }) => request<HomeNotice>('/notices', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: { title: string; content: string; sortOrder: number }) => request<HomeNotice>(`/notices/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  remove: (id: string) => request<{ id: string; deleted: true }>(`/notices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
