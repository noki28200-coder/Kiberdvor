import { z } from 'zod';
import { fetchJson } from './provider';

const ownedGamesSchema = z.object({
  response: z.object({
    games: z.array(z.object({ appid: z.number(), playtime_forever: z.number() })).optional(),
  }),
});

const playerSummariesSchema = z.object({
  response: z.object({
    players: z.array(
      z.object({ steamid: z.string(), personaname: z.string(), avatarfull: z.string().optional() }),
    ),
  }),
});

export function createSteamWebApi(apiKey: string | undefined) {
  return {
    /** Часы в игре; null, если ключа нет или профиль закрыт. */
    async hoursPlayed(steamId: string, appId: number): Promise<number | null> {
      if (!apiKey) return null;
      const data = await fetchJson(
        `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&appids_filter[0]=${appId}`,
        ownedGamesSchema,
      );
      const game = data?.response.games?.find((g) => g.appid === appId);
      return game ? Math.round(game.playtime_forever / 60) : null;
    },

    async playerSummary(steamId: string) {
      if (!apiKey) return null;
      const data = await fetchJson(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`,
        playerSummariesSchema,
      );
      const player = data?.response.players[0];
      return player
        ? { personaName: player.personaname, avatarUrl: player.avatarfull ?? null }
        : null;
    },
  };
}

export type SteamWebApi = ReturnType<typeof createSteamWebApi>;
