import type { CatvManpowerStatus } from '../../types';
import { apiResourceUrl, request } from '../../shared/api/client';

export type ManpowerEnvelope = {
  status: CatvManpowerStatus;
  version: number;
  updatedAt: string;
};

export const manpowerApi = {
  get: () => request<ManpowerEnvelope>('/manpower'),
  update: (status: CatvManpowerStatus) => request<ManpowerEnvelope>('/manpower', {
    method: 'PUT',
    body: JSON.stringify(status),
  }),
  eventsUrl: () => apiResourceUrl('/api/manpower/events'),
};
