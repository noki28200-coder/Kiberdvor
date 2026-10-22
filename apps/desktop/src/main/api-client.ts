import type { Me } from '@kiberdvor/shared';
import { BrowserWindow, session } from 'electron';
import { settings } from './settings';

/**
 * Клиент работает с API от имени пользователя через ту же сессию, в которой он вошёл
 * на сайт (Яндекс ID) в окне входа: куки живут в отдельном постоянном разделе.
 */
export const PARTITION = 'persist:kiberdvor';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ses = session.fromPartition(PARTITION);
  const res = await ses.fetch(`${settings.get().serverUrl}/api${path}`, {
    method,
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

export async function currentUser(): Promise<Me | null> {
  try {
    return await apiRequest<Me>('GET', '/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Окно входа: обычная страница сайта, вход через Яндекс ID. Закрывается само после входа. */
export function openLoginWindow(parent: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      width: 520,
      height: 720,
      title: 'Вход в Кибердвор',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const check = async () => {
      if (await currentUser().catch(() => null)) win.close();
    };
    win.webContents.on('did-navigate', () => void check());
    win.webContents.on('did-navigate-in-page', () => void check());
    win.on('closed', () => resolve());
    void win.loadURL(`${settings.get().serverUrl}/login`);
  });
}

export async function logout() {
  await apiRequest('POST', '/auth/logout').catch(() => undefined);
  await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] });
}
