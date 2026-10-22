import type { Game } from '@kiberdvor/shared';
import type { z } from 'zod';

export interface AccountInfo {
  rankInGame: string | null;
  hoursPlayed: number | null;
}

export interface MatchSides {
  team1SteamIds: string[];
  team2SteamIds: string[];
}

export type ExternalVerification =
  { ok: true; team1Won: boolean; score1: number; score2: number } | { ok: false; reason: string };

/**
 * Всё, что отличает одну игру от другой. Турниры, драфт и матчи работают только
 * через этот интерфейс: новая игра — новый адаптер, без правок в остальном коде.
 */
export interface GameProvider {
  game: Game;
  /**
   * Как приходит результат:
   * - external_id: капитан вводит ID матча, сайт проверяет его через API игры (Dota 2);
   * - server: игровой сервер на ПК хоста сам шлёт счёт (CS2 + MatchZy);
   * - submissions: каждый игрок присылает свои очки со скриншотом (FPV).
   */
  resultMode: 'external_id' | 'server' | 'submissions';
  /** Нужен ли выбор хоста перед матчем. */
  needsHost: boolean;
  fetchAccountInfo(steamId: string): Promise<AccountInfo>;
  /** Стартовый рейтинг Glicko-2 по рангу в игре (таблица соответствия). */
  initialRating(steamId: string): Promise<number>;
  /** Данные лобби, которые сайт выдаёт капитану (Dota 2). */
  createLobby?(): { name: string; password: string };
  verifyExternalMatch?(externalMatchId: string, sides: MatchSides): Promise<ExternalVerification>;
}

export const STEAM_ID64_BASE = 76561197960265728n;
export const toAccountId32 = (steamId64: string) => Number(BigInt(steamId64) - STEAM_ID64_BASE);

/** GET к внешнему API с таймаутом и проверкой ответа zod-схемой. Ошибка сети → null. */
export async function fetchJson<T extends z.ZodType>(
  url: string,
  schema: T,
  init: RequestInit = {},
): Promise<z.infer<T> | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
