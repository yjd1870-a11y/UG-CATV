import type { HomeWorkSummary } from '../../types';
import { request } from '../../shared/api/client';

export const homeApi = {
  summary: () => request<HomeWorkSummary>('/home/summary'),
};
