import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'API_ERROR'
  ) {
    super(message);
  }
}

export const asyncRoute = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const success = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data });

export const fail = (res: Response, message: string, status = 400, code = 'REQUEST_FAILED') =>
  res.status(status).json({ success: false, message, code });

export const asText = (value: unknown, field: string, maxLength = 255): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} 항목은 필수입니다.`, 'VALIDATION_ERROR');
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ApiError(400, `${field} 항목은 ${maxLength}자 이하여야 합니다.`, 'VALIDATION_ERROR');
  }
  return normalized;
};

export const optionalText = (value: unknown, maxLength = 2000): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new ApiError(400, `문자열 항목은 ${maxLength}자 이하여야 합니다.`, 'VALIDATION_ERROR');
  }
  return value.trim();
};

export const asPositiveNumber = (value: unknown, field: string): number => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new ApiError(400, `${field} 항목은 0보다 큰 숫자여야 합니다.`, 'VALIDATION_ERROR');
  }
  return numberValue;
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    fail(res, error.message, error.status, error.code);
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    fail(res, '요청 데이터 형식이 올바르지 않습니다.', 400, 'INVALID_JSON');
    return;
  }

  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
    fail(res, '요청 데이터가 허용된 크기를 초과했습니다.', 413, 'PAYLOAD_TOO_LARGE');
    return;
  }

  console.error('[API_ERROR]', error);
  fail(res, '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500, 'INTERNAL_ERROR');
};
