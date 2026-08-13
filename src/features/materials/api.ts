import type { MaterialUsageRecord } from '../../types';
import { request } from '../../shared/api/client';

export const materialsApi = {
  list: () => request<Array<Record<string, unknown>>>('/materials'),
  usage: () => request<MaterialUsageRecord[]>('/material-usage'),
  addUsage: (input: Omit<MaterialUsageRecord, 'id' | 'createdAt' | 'workerName'>) =>
    request<MaterialUsageRecord>('/material-usage', { method: 'POST', body: JSON.stringify(input) }),
};
