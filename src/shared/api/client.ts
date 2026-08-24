import { resolveApiResourceUrl } from './url';

type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'API_ERROR'
  ) {
    super(message);
  }
}

const DEFAULT_PRODUCTION_API_BASE = 'https://ratis-transmission-webapp-yjd1870.onrender.com/api';
const defaultApiBase = import.meta.env.PROD ? DEFAULT_PRODUCTION_API_BASE : '/api';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, '');

export const apiResourceUrl = (resourceUrl: string) => resolveApiResourceUrl(API_BASE, resourceUrl);

export const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => ({
    success: false,
    message: '서버 응답을 확인할 수 없습니다.',
  }))) as ApiEnvelope<T>;

  if (!response.ok || !payload.success) {
    const failed = payload as Extract<ApiEnvelope<T>, { success: false }>;
    throw new ApiClientError(
      failed.message || '요청을 처리하지 못했습니다.',
      response.status,
      failed.code
    );
  }
  return payload.data;
};

export const downloadFile = async (path: string, fallbackFilename: string) => {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: '파일을 생성하지 못했습니다. 다시 시도해주세요.' }));
    throw new ApiClientError(payload.message || '파일을 생성하지 못했습니다. 다시 시도해주세요.', response.status, payload.code);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = matched ? decodeURIComponent(matched[1]) : fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
