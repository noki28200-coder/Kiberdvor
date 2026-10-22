// Интерфейс античита. Публичный код работает с заглушками ниже; настоящая реализация
// живёт в приватном репозитории (packages/private) и подключается, только если он есть.
//
// Античит в клиенте — лишь дополнительный барьер: Electron-приложение легко распаковать.
// Результаты матчей, рейтинг и подписку решает только сервер (apps/api).
import { z } from 'zod';

export const antiCheatReportSchema = z.object({
  /** Какая реализация собрала отчёт: 'noop' — публичная заглушка. */
  provider: z.string().max(64),
  version: z.string().max(32),
  matchId: z.uuid(),
  createdAt: z.iso.datetime(),
  /** Непрозрачные данные реализации; сервер не доверяет им без проверки. */
  payload: z.record(z.string(), z.unknown()),
  signature: z.string().max(1024).nullable(),
});
export type AntiCheatReport = z.infer<typeof antiCheatReportSchema>;

export interface ClientAntiCheatContext {
  matchId: string;
  steamId: string;
  /** Путь к установленной игре или серверу, если он известен клиенту. */
  gamePath: string | null;
}

/** Часть, которая работает в десктоп-клиенте (main-процесс Electron). */
export interface ClientAntiCheat {
  readonly provider: string;
  readonly version: string;
  /** Запуск наблюдения на время матча. */
  start(context: ClientAntiCheatContext): Promise<void>;
  /** Отчёт, который клиент прикладывает к результату матча. */
  collectReport(matchId: string): Promise<AntiCheatReport>;
  stop(): Promise<void>;
}

export type AntiCheatVerdict =
  | { status: 'clean' }
  /** Подозрение — матч уходит организатору на проверку, сам результат не меняется. */
  | { status: 'suspicious'; reason: string }
  /** Нет данных для проверки (например, публичная сборка без античита). */
  | { status: 'unchecked' };

/** Часть, которая проверяет отчёты клиента на сервере. */
export interface ServerAntiCheat {
  readonly provider: string;
  verifyReport(
    report: AntiCheatReport | null,
    context: { matchId: string; userId: string },
  ): Promise<AntiCheatVerdict>;
}

export const noopClientAntiCheat: ClientAntiCheat = {
  provider: 'noop',
  version: '0',
  async start() {},
  async collectReport(matchId) {
    return {
      provider: 'noop',
      version: '0',
      matchId,
      createdAt: new Date().toISOString(),
      payload: {},
      signature: null,
    };
  },
  async stop() {},
};

export const noopServerAntiCheat: ServerAntiCheat = {
  provider: 'noop',
  async verifyReport() {
    return { status: 'unchecked' };
  },
};
