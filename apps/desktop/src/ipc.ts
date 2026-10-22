// Типизированный контракт между preload и main. Renderer видит только window.kiberdvor.

export interface AppInfo {
  version: string;
  platform: string;
  /** 'noop' — публичная сборка без приватного античита. */
  antiCheatProvider: string;
}

export interface KiberdvorBridge {
  getAppInfo(): Promise<AppInfo>;
}

export const IPC = {
  getAppInfo: 'app:get-info',
} as const;
