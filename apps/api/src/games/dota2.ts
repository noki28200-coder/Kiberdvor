import { z } from 'zod';
import { humanCode } from '../crypto';
import { fetchJson, toAccountId32, type GameProvider } from './provider';
import type { SteamWebApi } from './steam-web-api';

const DOTA_APP_ID = 570;
const MEDALS = ['Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'];

const playerSchema = z.object({ rank_tier: z.number().nullable().optional() });
const matchSchema = z.object({
  radiant_win: z.boolean(),
  radiant_score: z.number().optional(),
  dire_score: z.number().optional(),
  players: z.array(z.object({ account_id: z.number().nullable(), player_slot: z.number() })),
});

/** rank_tier OpenDota: десятки — медаль 1–8, единицы — звёзды 0–5. */
export function rankTierToRating(rankTier: number | null | undefined): number {
  if (!rankTier) return 1500;
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  return 800 + (medal - 1) * 200 + stars * 35;
}

export function rankTierLabel(rankTier: number | null | undefined): string | null {
  if (!rankTier) return null;
  const medal = MEDALS[Math.floor(rankTier / 10) - 1];
  const stars = rankTier % 10;
  return medal ? (stars > 0 ? `${medal} ${stars}` : medal) : null;
}

export function createDota2Provider(steam: SteamWebApi): GameProvider {
  const fetchRankTier = async (steamId: string) => {
    const data = await fetchJson(
      `https://api.opendota.com/api/players/${toAccountId32(steamId)}`,
      playerSchema,
    );
    return data?.rank_tier ?? null;
  };

  return {
    game: 'dota2',
    resultMode: 'external_id',
    needsHost: false,

    async fetchAccountInfo(steamId) {
      const [rankTier, hoursPlayed] = await Promise.all([
        fetchRankTier(steamId),
        steam.hoursPlayed(steamId, DOTA_APP_ID),
      ]);
      return { rankInGame: rankTierLabel(rankTier), hoursPlayed };
    },

    async initialRating(steamId) {
      return rankTierToRating(await fetchRankTier(steamId));
    },

    createLobby() {
      return { name: `kiberdvor-${humanCode(6).toLowerCase()}`, password: humanCode(8) };
    },

    async verifyExternalMatch(externalMatchId, { team1SteamIds, team2SteamIds }) {
      const match = await fetchJson(
        `https://api.opendota.com/api/matches/${externalMatchId}`,
        matchSchema,
      );
      if (!match) {
        return {
          ok: false,
          reason: 'OpenDota пока не знает этот матч. Подождите пару минут и попробуйте снова.',
        };
      }
      const radiant = new Set(
        match.players.filter((p) => p.player_slot < 128).map((p) => p.account_id),
      );
      const dire = new Set(
        match.players.filter((p) => p.player_slot >= 128).map((p) => p.account_id),
      );
      const count = (ids: string[], side: Set<number | null>) =>
        ids.filter((id) => side.has(toAccountId32(id))).length;

      // Часть профилей скрыта (account_id = null), поэтому требуем, чтобы нашлась хотя бы половина каждой команды.
      const need = (ids: string[]) => Math.max(1, Math.ceil(ids.length / 2));
      const t1Radiant =
        count(team1SteamIds, radiant) >= need(team1SteamIds) &&
        count(team2SteamIds, dire) >= need(team2SteamIds);
      const t1Dire =
        count(team1SteamIds, dire) >= need(team1SteamIds) &&
        count(team2SteamIds, radiant) >= need(team2SteamIds);
      if (!t1Radiant && !t1Dire) {
        return {
          ok: false,
          reason:
            'Составы в матче не совпадают с командами турнира. Проверьте ID или откройте спор.',
        };
      }
      const team1Won = t1Radiant ? match.radiant_win : !match.radiant_win;
      return { ok: true, team1Won, score1: team1Won ? 1 : 0, score2: team1Won ? 0 : 1 };
    },
  };
}
