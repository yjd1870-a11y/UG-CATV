import type { WorkTransfer } from '../../types';
import { request } from '../../shared/api/client';

export const transfersApi = {
  list: () => request<WorkTransfer[]>('/work-transfers'),
  create: (transfer: Omit<WorkTransfer, 'id' | 'logs'>) => request<WorkTransfer>('/work-transfers', {
    method: 'POST', body: JSON.stringify(transfer),
  }),
  update: (id: string, updates: Record<string, unknown>) => request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(updates),
  }),
};
