import { z } from 'zod';
import { fetchJson, type GameProvider } from './provider';
import type { SteamWebApi } from './steam-web-api';

const CS2_APP_ID = 730;

const faceitPlayerSchema = z.object({
  games: z.object({
    cs2: z.object({ faceit_elo: z.number(), skill_level: z.number() }).optional(),
  }),
});

/** FACEIT Elo (100–3000+) → Glicko-2. Таблица соответствия грубая, уточнить по данным пилота. */
export function faceitEloToRating(elo: number | null): number {
  if (elo === null) return 1500;
  return Math.round(Math.min(2300, Math.max(800, 1000 + (elo - 800) * 0.5)));
}

export function createCs2Provider(
  steam: SteamWebApi,
  faceitApiKey: string | undefined,
): GameProvider {
  const fetchFaceit = async (steamId: string) => {
    if (!faceitApiKey) return null;
    const data = await fetchJson(
      `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${steamId}`,
      faceitPlayerSchema,
      { headers: { Authorization: `Bearer ${faceitApiKey}` } },
    );
    return data?.games.cs2 ?? null;
  };

  return {
    game: 'cs2',
    resultMode: 'server',
    needsHost: true,

    async fetchAccountInfo(steamId) {
      const [faceit, hoursPlayed] = await Promise.all([
        fetchFaceit(steamId),
        steam.hoursPlayed(steamId, CS2_APP_ID),
      ]);
      return {
        rankInGame: faceit ? `FACEIT ${faceit.skill_level} lvl (${faceit.faceit_elo} Elo)` : null,
        hoursPlayed,
      };
    },

    async initialRating(steamId) {
      const faceit = await fetchFaceit(steamId);
      return faceitEloToRating(faceit?.faceit_elo ?? null);
    },
  };
}

/** Пул карт для вето в MatchZy. Актуальный Active Duty перепроверить перед пилотом. */
export const CS2_MAP_POOL = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_train',
];
