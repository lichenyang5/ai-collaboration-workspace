const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function createApiUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), `${apiBaseUrl.replace(/\/+$/, '')}/`).toString();
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(createApiUrl(path), {
    credentials: 'include',
    ...init,
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : '请求失败，请稍后重试';
    throw new ApiError(message, response.status);
  }

  return payload as T;
}