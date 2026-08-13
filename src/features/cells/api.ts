import type {
  CellInfo,
  CatvB2CLine,
  CatvCell,
  CatvFloorPlanResult,
  StraightMapMetadata,
  StraightMapSearchResult,
} from '../../types';
import { request } from '../../shared/api/client';

type Page<T> = { items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } };

export const cellsApi = {
  list: async () => (await request<Page<CellInfo>>('/cells?limit=100')).items,
  search: async (name: string) =>
    (await request<Page<CellInfo>>(`/cells/search?name=${encodeURIComponent(name)}&limit=50`)).items,
  detail: async (id: string) => (await request<{ cell: CellInfo }>(`/cells/${encodeURIComponent(id)}`)).cell,
  create: (input: Record<string, unknown>) => request<{ id: string }>('/cells', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Record<string, unknown>) => request<{ id: string }>(`/cells/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => request<{ id: string; deleted: true }>(`/cells/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addPhoto: (cellId: string, photo: Record<string, unknown>) => request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/photos`, {
    method: 'POST', body: JSON.stringify(photo),
  }),
  addHistory: (cellId: string, history: Record<string, unknown>) => request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/history`, {
    method: 'POST', body: JSON.stringify(history),
  }),
  updateHistory: (cellId: string, historyId: string, updates: Record<string, unknown>) => request<{ id: string }>(`/cells/${encodeURIComponent(cellId)}/history/${encodeURIComponent(historyId)}`, {
    method: 'PUT', body: JSON.stringify(updates),
  }),
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
  getFloorPlan: (stationName: string, target: string, type: 'node' | 'rack' = 'node', equipment = '') =>
    request<CatvFloorPlanResult>(
      `/floor-plans/search?station=${encodeURIComponent(stationName)}&target=${encodeURIComponent(target)}&type=${encodeURIComponent(type)}&equipment=${encodeURIComponent(equipment)}`
    ),
  searchStraightMap: async (query: string, stationName = '', mapName = '', matchLength: 5 | 6 = 6) => (
    await request<{ count: number; results: StraightMapSearchResult[] }>(
      `/straight-maps/search?q=${encodeURIComponent(query)}&matchLength=${matchLength}${stationName ? `&station=${encodeURIComponent(stationName)}` : ''}${mapName ? `&map=${encodeURIComponent(mapName)}` : ''}`
    )
  ).results,
  getStraightMap: (mapId: string) => request<StraightMapMetadata>(`/straight-maps/${encodeURIComponent(mapId)}`),
};
