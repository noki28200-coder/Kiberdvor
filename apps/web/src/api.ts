import type { Me } from '@kiberdvor/shared';
import { useQuery } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : `Ошибка ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

// Ответы формирует наш API, их типы общие с бэкендом (@kiberdvor/shared/views).
export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = { ok: true }>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = { ok: true }>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = { ok: true }>(path: string) => request<T>('DELETE', path),
};

/** Текущий пользователь; null — не вошёл. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Что-то пошло не так';
