import type { ServerAntiCheat } from '@kiberdvor/shared';
import { Socket } from 'node:net';
import type { Db } from './db/client';
import type { Env } from './env';
import type { GameProviders } from './games';
import type { SteamWebApi } from './games/steam-web-api';
import type { Notifier } from './notifications/notifier';
import type { Realtime } from './notifications/realtime';

export interface AppContext {
  env: Env;
  db: Db;
  providers: GameProviders;
  steam: SteamWebApi;
  realtime: Realtime;
  notifier: Notifier;
  /** Проверка отчётов античита: приватная реализация или заглушка (см. anticheat.ts). */
  antiCheat: ServerAntiCheat;
  now: () => Date;
  /** Проверка, что порт кандидата в хосты доступен из интернета (серый IP → false). */
  checkPort: (ip: string, port: number) => Promise<boolean>;
  /** Планировщик таймеров драфта; подставляется при сборке приложения. */
  draftTimers: {
    schedule(tournamentId: string, deadline: Date): void;
    cancel(tournamentId: string): void;
  };
}

export function tcpCheck(ip: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });
}
