import type {
  CellInfo,
  CatvB2CLine,
  CatvCell,
  CatvFloorPlanResult,
  StraightMapMetadata,
  StraightMapSearchResult,
} from '../../types';
import { ApiClientError, request } from '../../shared/api/client';

type Page<T> = { items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } };

const uploadPhoto = async (cellId: string, photo: Record<string, unknown>) => {
  const dataUrl = typeof photo.url === 'string' ? photo.url : '';
  const matched = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!matched) {
    return request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/photos`, {
      method: 'POST', body: JSON.stringify(photo),
    });
  }
  const binary = atob(matched[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: matched[1].toLowerCase() });
  let signed: { objectKey: string; uploadUrl: string; expiresAt: string };
  try {
    signed = await request(`/cells/${encodeURIComponent(cellId)}/photos/upload-url`, {
      method: 'POST',
      body: JSON.stringify({ mimeType: blob.type, size: blob.size }),
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'DIRECT_UPLOAD_UNAVAILABLE') {
      return request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/photos`, {
        method: 'POST', body: JSON.stringify(photo),
      });
    }
    throw error;
  }
  const uploaded = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  if (!uploaded.ok) throw new ApiClientError('사진을 R2에 업로드하지 못했습니다.', uploaded.status, 'R2_UPLOAD_FAILED');
  const { url: _url, ...metadata } = photo;
  return request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/photos/complete`, {
    method: 'POST',
    body: JSON.stringify({ ...metadata, objectKey: signed.objectKey }),
  });
};

const uploadHistoryPhoto = async (cellId: string, historyId: string, dataUrl: string) => {
  const matched = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!matched) throw new ApiClientError('작업이력 사진 형식이 올바르지 않습니다.', 400, 'INVALID_PHOTO_TYPE');
  const binary = atob(matched[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: matched[1].toLowerCase() });
  const basePath = `/cells/${encodeURIComponent(cellId)}/history/${encodeURIComponent(historyId)}/photos`;
  let signed: { objectKey: string; uploadUrl: string; expiresAt: string };
  try {
    signed = await request(`${basePath}/upload-url`, {
      method: 'POST', body: JSON.stringify({ mimeType: blob.type, size: blob.size }),
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'DIRECT_UPLOAD_UNAVAILABLE') {
      return request<{ id: string }>(basePath, { method: 'POST', body: JSON.stringify({ url: dataUrl }) });
    }
    throw error;
  }
  const uploaded = await fetch(signed.uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
  });
  if (!uploaded.ok) throw new ApiClientError('작업이력 사진을 R2에 업로드하지 못했습니다.', uploaded.status, 'R2_UPLOAD_FAILED');
  return request<{ id: string }>(`${basePath}/complete`, {
    method: 'POST', body: JSON.stringify({ objectKey: signed.objectKey }),
  });
};

export const cellsApi = {
  list: async () => (await request<Page<CellInfo>>('/cells?limit=100')).items,
  search: async (name: string) =>
    (await request<Page<CellInfo>>(`/cells/search?name=${encodeURIComponent(name)}&limit=50`)).items,
  detail: async (id: string) => (await request<{ cell: CellInfo }>(`/cells/${encodeURIComponent(id)}`)).cell,
  create: (input: Record<string, unknown>) => request<{ id: string }>('/cells', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Record<string, unknown>) => request<{ id: string }>(`/cells/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => request<{ id: string; deleted: true }>(`/cells/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addPhoto: uploadPhoto,
  addHistory: async (cellId: string, history: Record<string, unknown>) => {
    const photos = Array.isArray(history.photos)
      ? history.photos.filter((photo): photo is string => typeof photo === 'string').slice(0, 3)
      : [];
    const { photos: _photos, ...metadata } = history;
    const created = await request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/history`, {
      method: 'POST', body: JSON.stringify(metadata),
    });
    try {
      for (const photo of photos) await uploadHistoryPhoto(cellId, created.id, photo);
      return created;
    } catch (error) {
      await request(`/cells/${encodeURIComponent(cellId)}/history/${encodeURIComponent(created.id)}`, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
  },
  updateHistory: async (cellId: string, historyId: string, updates: Record<string, unknown>) => {
    const photos = Array.isArray(updates.photos)
      ? updates.photos.filter((photo): photo is string => typeof photo === 'string').slice(0, 3)
      : null;
    const newPhotos = photos?.filter((photo) => photo.startsWith('data:image/')) || [];
    const retainedPhotos = photos?.filter((photo) => !photo.startsWith('data:image/')) || [];
    const response = await request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/history/${encodeURIComponent(historyId)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...updates, ...(photos ? { photos: retainedPhotos } : {}) }),
    });
    for (const photo of newPhotos) await uploadHistoryPhoto(cellId, historyId, photo);
    return response;
  },
  deleteHistory: (cellId: string, historyId: string) => request<{ id: string; deleted: true }>(`/cells/${encodeURIComponent(cellId)}/history/${encodeURIComponent(historyId)}`, {
    method: 'DELETE',
  }),
};

export const catvApi = {
  searchCells: async (query: string) => (
    await request<{ items: CatvCell[]; total: number }>(`/cells/search?q=${encodeURIComponent(query)}`)
  ).items,
  getCell: (id: string) => request<CatvCell>(`/cells/${encodeURIComponent(id)}/transmission`),
  searchB2C: async (query: string) => (
    await request<{ items: CatvB2CLine[]; total: number }>(`/b2c/search?q=${encodeURIComponent(query)}`)
  ).items,
  getB2C: (id: string) => request<CatvB2CLine>(`/b2c/${encodeURIComponent(id)}`),
  getFloorPlan: (stationName: string, target: string, type: 'node' | 'rack' = 'node', equipment = '', planId = '') =>
    request<CatvFloorPlanResult>(
      `/floor-plans/search?station=${encodeURIComponent(stationName)}&target=${encodeURIComponent(target)}&type=${encodeURIComponent(type)}&equipment=${encodeURIComponent(equipment)}${planId ? `&planId=${encodeURIComponent(planId)}` : ''}`
    ),
  searchStraightMap: async (query: string, stationName = '', mapName = '', matchLength: 5 | 6 = 6) => (
    await request<{ count: number; results: StraightMapSearchResult[] }>(
      `/straight-maps/search?q=${encodeURIComponent(query)}&matchLength=${matchLength}${stationName ? `&station=${encodeURIComponent(stationName)}` : ''}${mapName ? `&map=${encodeURIComponent(mapName)}` : ''}`
    )
  ).results,
  getStraightMap: (mapId: string) => request<StraightMapMetadata>(`/straight-maps/${encodeURIComponent(mapId)}`),
};
