import { API_BASE, apiResourceUrl, request, ApiClientError } from '../../shared/api/client';
import type { ManualCategory, ManualDetail, ManualModel, ManualKind, ModelInput } from './types';

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const manualApi = {
  categories: (signal?: AbortSignal) => request<{ items: ManualCategory[]; canManage: boolean }>('/manual/categories', { signal }),
  models: (id: string, signal?: AbortSignal) => request<ManualModel[]>(`/manual/categories/${encodeURIComponent(id)}/models`, { signal }),
  detail: (id: string, signal?: AbortSignal) => request<ManualDetail>(`/manual/models/${encodeURIComponent(id)}`, { signal }),
  category: (id: string | null, input: { name: string; description: string }) => request<{ id: string }>(id ? `/manual/categories/${id}` : '/manual/categories', json(id ? 'PUT' : 'POST', input)),
  model: (id: string | null, input: ModelInput) => request<ManualModel>(id ? `/manual/models/${id}` : '/manual/models', json(id ? 'PUT' : 'POST', input)),
  text: (id: string, input: { body: string; tips: string; version: number }) => request<ManualModel>(`/manual/models/${id}/text`, json('PUT', input)),
  image: (id: string, assetId: string) => request<ManualModel>(`/manual/models/${id}/image`, json('PUT', { assetId })),
  deleteCategory: (id: string) => request(`/manual/categories/${id}`, { method: 'DELETE' }),
  deleteModel: (id: string) => request(`/manual/models/${id}`, { method: 'DELETE' }),
  deleteAsset: (id: string) => request(`/manual/assets/${id}`, { method: 'DELETE' }),
  editAsset: (id: string, title: string, posterId: string | null) => request(`/manual/assets/${id}`, json('PATCH', { title, posterId })),
  upload: async (modelId: string, file: File, kind: ManualKind, title: string, posterId: string | null, onProgress: (value: number) => void, purpose: 'manual' | 'model-cover' = 'manual') => {
    const intent = await request<{ id: string; uploadUrl: string }>(`/manual/models/${modelId}/uploads`, json('POST', {
      kind, title, fileName: file.name, mime: file.type, bytes: file.size, posterId, purpose,
    }));
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('PUT', apiResourceUrl(intent.uploadUrl)); xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', file.type); xhr.timeout = 20 * 60 * 1000;
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => {
          let result: { success?: boolean; message?: string } = {};
          try { result = JSON.parse(xhr.responseText); } catch { /* handled below */ }
          if (xhr.status >= 200 && xhr.status < 300 && result.success) resolve();
          else reject(new ApiClientError(result.message || '파일을 등록하지 못했습니다.', xhr.status));
        };
        xhr.onerror = () => reject(new Error('파일 전송에 실패했습니다. 연결 상태를 확인해주세요.'));
        xhr.ontimeout = () => reject(new Error('전송 시간이 초과되었습니다. 파일을 압축한 후 다시 시도해주세요.'));
        xhr.send(file);
      });
      return intent.id;
    } catch (error) { await manualApi.deleteAsset(intent.id).catch(() => {}); throw error; }
  },
};
export const manualResourceUrl = (url: string) => apiResourceUrl(url);
export const manualFileUrl = (id: string, download = false) => `${API_BASE}/manual/assets/${id}/content${download ? '?download=1' : ''}`;
export const manualDetailHref = (id: string) => `/manual/models/${encodeURIComponent(id)}`;
