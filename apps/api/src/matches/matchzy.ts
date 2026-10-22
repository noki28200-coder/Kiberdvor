import { CS2_MAP_POOL } from '../games/cs2';

export const MATCHZY_TOKEN_HEADER = 'X-Match-Token';

interface MatchzyTeam {
  name: string;
  players: Record<string, string>;
}

/**
 * Конфиг матча для MatchZy (matchzy_loadmatch_url). Формат Get5-совместимый:
 * составы по SteamID — посторонний не зайдёт; MR12 — значение CS2 по умолчанию;
 * num_maps=1 и пул из 7 карт — вето проходит прямо в игре.
 */
export function buildMatchzyConfig(input: {
  matchId: string;
  team1: MatchzyTeam;
  team2: MatchzyTeam;
  playersPerTeam: number;
  remoteLogUrl: string;
  token: string;
  serverPassword: string;
}) {
  return {
    // MatchZy ждёт числовой matchid; наш uuid сопоставляется по токену, а не по номеру.
    matchid: Number.parseInt(input.matchId.replaceAll('-', '').slice(0, 7), 16),
    team1: input.team1,
    team2: input.team2,
    num_maps: 1,
    maplist: CS2_MAP_POOL,
    clinch_series: true,
    players_per_team: input.playersPerTeam,
    cvars: {
      hostname: `Кибердвор: ${input.team1.name} vs ${input.team2.name}`,
      sv_password: input.serverPassword,
      matchzy_remote_log_url: input.remoteLogUrl,
      matchzy_remote_log_header_key: MATCHZY_TOKEN_HEADER,
      matchzy_remote_log_header_value: input.token,
    },
  };
}

/** Итог серии из события MatchZy: series_end с team1/2_series_score и winner.team. */
export function seriesResult(event: {
  event: string;
  team1_series_score?: number;
  team2_series_score?: number;
  winner?: { team?: string };
}): { team1Won: boolean; score1: number; score2: number } | null {
  if (event.event !== 'series_end') return null;
  const score1 = event.team1_series_score ?? 0;
  const score2 = event.team2_series_score ?? 0;
  const team1Won = event.winner?.team ? event.winner.team === 'team1' : score1 > score2;
  return { team1Won, score1, score2 };
}
