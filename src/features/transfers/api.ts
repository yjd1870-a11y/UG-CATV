import type { TransferWorkflowStatus, WorkTransfer } from '../../types';
import { apiResourceUrl, downloadFile, request } from '../../shared/api/client';

export type TransferFilters = {
  status?: TransferWorkflowStatus | '';
  regionId?: string;
  from?: string;
  to?: string;
  urgent?: boolean;
  q?: string;
  fieldProcessorId?: string;
};

export type AnalyticsPeriodType = 'month' | 'range' | 'year';
export type AnalyticsDetailMetric = 'received' | 'registered' | 'fieldProcessed' | 'completedFromReceived' | 'completedInPeriod' | 'urgent';
export type TransferAnalyticsFilters = {
  periodType: AnalyticsPeriodType;
  month?: string;
  year?: string;
  from?: string;
  to?: string;
  regionId?: string;
  fieldProcessorId?: string;
  urgent?: 'all' | 'true' | 'false';
  detailMetric?: AnalyticsDetailMetric;
  detailPage?: number;
  detailLimit?: number;
};

export type TransferAnalyticsMeta = {
  regions: Array<{ id: string; name: string }>;
  fieldProcessors: Array<{ id: string; name: string; regionId: string | null; regionName: string }>;
  currentRegionId: string | null;
  currentRegionName: string | null;
  regionLocked: boolean;
};

export type TransferAnalytics = {
  filters: TransferAnalyticsFilters & { from: string; to: string; bucket: 'day' | 'month' };
  summary: {
    received: number; registered: number; fieldProcessed: number; completedFromReceived: number;
    completedInPeriod: number; completionRate: number; urgent: number; averageProcessingHours: number | null;
  };
  trend: Array<{
    bucket: string; received: number; registered: number; fieldProcessed: number;
    completedFromReceived: number; completedInPeriod: number; completionRate: number; urgent: number;
  }>;
  byRegion: Array<{
    regionId: string | null; regionName: string; received: number; registered: number;
    fieldProcessed: number; completed: number; completionRate: number; urgent: number;
  }>;
  byFieldProcessor: Array<{
    fieldProcessorId: string | null; fieldProcessorName: string; regionName: string; received: number;
    processed: number; fieldProcessed: number; completed: number; completionRate: number;
    urgent: number; averageProcessingHours: number | null;
  }>;
  details: {
    metric: AnalyticsDetailMetric; page: number; limit: number; total: number;
    items: Array<{
      id: string; receivedDate: string; regionName: string; branchName: string; customerAddress: string;
      handoverReason: string; isUrgent: boolean; fieldProcessorName: string; fieldProcessedAt: string | null;
      completedAt: string | null; workflowStatus: string; processingHours: number | null;
    }>;
  };
};

export type TransferMeta = {
  regions: Array<{ id: string; name: string }>;
  currentRegionId: string | null;
  currentRegionName: string | null;
};

export type TransferSummary = Record<TransferWorkflowStatus, number>;

const queryString = (filters: TransferFilters = {}) => {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.regionId) query.set('regionId', filters.regionId);
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.urgent !== undefined) query.set('urgent', String(filters.urgent));
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.fieldProcessorId) query.set('fieldProcessorId', filters.fieldProcessorId);
  const value = query.toString();
  return value ? `?${value}` : '';
};

const analyticsQueryString = (filters: TransferAnalyticsFilters) => {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  return `?${query.toString()}`;
};

export const transfersApi = {
  list: (filters: TransferFilters = {}) => request<WorkTransfer[]>(`/work-transfers${queryString(filters)}`),
  detail: (id: string) => request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}`),
  meta: () => request<TransferMeta>('/work-transfers/meta'),
  summary: (filters: Omit<TransferFilters, 'status'> = {}) => request<TransferSummary>(`/work-transfers/summary${queryString(filters)}`),
  create: (transfer: Record<string, unknown>) => request<WorkTransfer>('/work-transfers', {
    method: 'POST', body: JSON.stringify(transfer),
  }),
  update: (id: string, updates: Record<string, unknown>) => request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(updates),
  }),
  remove: (id: string, reason: string) => request<{ id: string; deleted: boolean }>(`/work-transfers/${encodeURIComponent(id)}`, {
    method: 'DELETE', body: JSON.stringify({ reason }),
  }),
  addAttachment: (id: string, input: { attachmentType: 'request_photo' | 'field_photo'; fileName: string; dataUrl: string }) =>
    request<{ id: string }>(`/work-transfers/${encodeURIComponent(id)}/attachments`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  attachmentAccessUrl: async (id: string, attachmentId: string) => {
    const result = await request<{ url: string }>(`/work-transfers/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/access-url`);
    return apiResourceUrl(result.url);
  },
  addFieldAction: (id: string, input: { actionText: string; processedAt?: string }) =>
    request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}/field-actions`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  complete: (id: string, comment?: string) => request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}/complete`, {
    method: 'POST', body: JSON.stringify({ comment }),
  }),
  reopen: (id: string, reason: string) => request<WorkTransfer>(`/work-transfers/${encodeURIComponent(id)}/reopen`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
  analyticsMeta: () => request<TransferAnalyticsMeta>('/work-transfers/analytics/meta'),
  analytics: (filters: TransferAnalyticsFilters) => request<TransferAnalytics>(`/work-transfers/analytics${analyticsQueryString(filters)}`),
  exportAnalytics: (filters: TransferAnalyticsFilters) => downloadFile(
    `/work-transfers/analytics/export${analyticsQueryString(filters)}`,
    '업무이관-통계.csv',
  ),
};
