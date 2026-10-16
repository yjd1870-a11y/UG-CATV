import { apiResourceUrl, ApiClientError, request } from '../../shared/api/client';
import type { CcParticipationDocument } from './cc-participation-process';

export type CcParticipationInput = {
  introduction: string;
  introductionColor: string;
  bottomText: string;
  version: number;
  sections: { title: string; description: string; photoId: string | null }[];
};
export const ccParticipationApi = {
  get: (signal?: AbortSignal) => request<CcParticipationDocument>('/cc-participation', { signal }),
  save: (input: CcParticipationInput) => request<CcParticipationDocument>('/cc-participation', { method: 'PUT', body: JSON.stringify(input) }),
  discardPhoto: (id: string) => request(`/cc-participation/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadPhoto: async (file: File) => {
    const response = await fetch(apiResourceUrl('/api/cc-participation/photos'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type }, body: file });
    const result = await response.json();
    if (!response.ok || !result.success) throw new ApiClientError(result.message || '사진을 등록하지 못했습니다.', response.status);
    return result.data as { id: string; url: string };
  },
};
