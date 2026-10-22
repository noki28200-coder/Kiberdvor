import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';
import type { Database, Match } from 'brackets-model';
import type { TournamentFormat } from '@kiberdvor/shared';

/** Матч сетки без привязки к хранилищу. teamId — наши id команд. */
export interface BracketMatch {
  key: string;
  column: string;
  columnOrder: number;
  round: number;
  label: string;
  team1Id: string | null;
  team2Id: string | null;
  state: 'pending' | 'ready' | 'finished';
  score1: number | null;
  score2: number | null;
  winnerId: string | null;
}

interface EliminationState {
  kind: 'elimination';
  data: Database;
}

interface SwissMatch {
  key: string;
  round: number;
  team1Id: string;
  team2Id: string | null;
  score1: number | null;
  score2: number | null;
  winnerId: string | null;
}

interface SwissState {
  kind: 'swiss';
  teamIds: string[];
  rounds: number;
  matches: SwissMatch[];
}

export type BracketState = EliminationState | SwissState;

const STATUS_COMPLETED = 4;
const STATUS_READY = 2;
const STATUS_RUNNING = 3;

// ───────────────────────── Single / double elimination (brackets-manager) ─────────────────────────

async function loadManager(data?: Database) {
  const storage = new InMemoryDatabase();
  if (data) storage.setData(structuredClone(data));
  return { manager: new BracketsManager(storage), storage };
}

async function createElimination(
  seededTeamIds: string[],
  type: 'single_elimination' | 'double_elimination',
): Promise<EliminationState> {
  const { manager } = await loadManager();
  const size = 2 ** Math.ceil(Math.log2(Math.max(seededTeamIds.length, 2)));
  const seeding: (string | null)[] = [...seededTeamIds];
  while (seeding.length < size) seeding.push(null);
  await manager.create.stage({
    tournamentId: 0,
    name: 'Основная сетка',
    type,
    seeding,
    settings: {
      seedOrdering: ['inner_outer'],
      grandFinal: type === 'double_elimination' ? 'simple' : 'none',
    },
  });
  return { kind: 'elimination', data: await manager.export() };
}

function eliminationColumn(groupNumber: number, isDouble: boolean): string {
  if (!isDouble) return '';
  return groupNumber === 1 ? 'Верхняя сетка' : groupNumber === 2 ? 'Нижняя сетка' : 'Гранд-финал';
}

function eliminationMatches(state: EliminationState): BracketMatch[] {
  const { data } = state;
  const stage = data.stage[0];
  const isDouble = stage?.type === 'double_elimination';
  const teamOf = (participantId: number | string | null | undefined) => {
    if (participantId === null || participantId === undefined) return null;
    return data.participant.find((p) => p.id === participantId)?.name ?? null;
  };
  const roundsPerGroup = new Map<number | string, number>();
  for (const r of data.round) {
    roundsPerGroup.set(r.group_id, Math.max(roundsPerGroup.get(r.group_id) ?? 0, r.number));
  }

  return (data.match as Match[])
    .filter((m) => m.opponent1 !== null && m.opponent2 !== null)
    .map((m) => {
      const group = data.group.find((g) => g.id === m.group_id);
      const round = data.round.find((r) => r.id === m.round_id);
      const groupNumber = group?.number ?? 1;
      const roundNumber = round?.number ?? 1;
      const totalRounds = roundsPerGroup.get(m.group_id) ?? roundNumber;
      const column = eliminationColumn(groupNumber, isDouble);
      const roundName =
        groupNumber === 3
          ? 'Гранд-финал'
          : groupNumber === 1 && roundNumber === totalRounds && !isDouble
            ? 'Финал'
            : `Раунд ${roundNumber}`;
      const team1Id = teamOf(m.opponent1?.id);
      const team2Id = teamOf(m.opponent2?.id);
      const finished = m.status >= STATUS_COMPLETED;
      const winner =
        m.opponent1?.result === 'win' ? team1Id : m.opponent2?.result === 'win' ? team2Id : null;
      return {
        key: `e-${m.id}`,
        column: column ? `${column}` : roundName,
        columnOrder: groupNumber * 100 + roundNumber,
        round: roundNumber,
        label: column ? `${column}, ${roundName.toLowerCase()}` : roundName,
        team1Id,
        team2Id,
        state: finished
          ? 'finished'
          : (m.status === STATUS_READY || m.status === STATUS_RUNNING) && team1Id && team2Id
            ? 'ready'
            : 'pending',
        score1: m.opponent1?.score ?? null,
        score2: m.opponent2?.score ?? null,
        winnerId: finished ? winner : null,
      } satisfies BracketMatch;
    });
}

async function reportElimination(
  state: EliminationState,
  key: string,
  winnerId: string,
  score1: number,
  score2: number,
): Promise<EliminationState> {
  const { manager } = await loadManager(state.data);
  const matchId = Number(key.slice(2));
  const match = state.data.match.find((m) => m.id === matchId);
  const team1 = state.data.participant.find((p) => p.id === match?.opponent1?.id)?.name;
  const team1Won = team1 === winnerId;
  await manager.update.match({
    id: matchId,
    opponent1: { score: score1, result: team1Won ? 'win' : 'loss' },
    opponent2: { score: score2, result: team1Won ? 'loss' : 'win' },
  });
  return { kind: 'elimination', data: await manager.export() };
}

// ───────────────────────── Швейцарская система ─────────────────────────

function swissRecord(state: SwissState) {
  const wins = new Map(state.teamIds.map((id) => [id, 0]));
  const losses = new Map(state.teamIds.map((id) => [id, 0]));
  for (const m of state.matches) {
    if (!m.winnerId) continue;
    wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
    const loser = m.winnerId === m.team1Id ? m.team2Id : m.team1Id;
    if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);
  }
  return { wins, losses };
}

/** Пары следующего тура: по очкам, затем по посеву; без повторных встреч, если возможно. */
export function pairSwissRound(state: SwissState, round: number): SwissMatch[] {
  const { wins } = swissRecord(state);
  const seedIndex = new Map(state.teamIds.map((id, i) => [id, i]));
  const played = new Set(
    state.matches.flatMap((m) =>
      m.team2Id ? [`${m.team1Id}|${m.team2Id}`, `${m.team2Id}|${m.team1Id}`] : [],
    ),
  );
  const hadBye = new Set(state.matches.filter((m) => !m.team2Id).map((m) => m.team1Id));
  const standing = [...state.teamIds].sort(
    (a, b) =>
      (wins.get(b) ?? 0) - (wins.get(a) ?? 0) || (seedIndex.get(a) ?? 0) - (seedIndex.get(b) ?? 0),
  );

  const result: SwissMatch[] = [];
  let pool = standing;
  if (pool.length % 2 === 1) {
    const byeTeam = [...pool].reverse().find((id) => !hadBye.has(id)) ?? pool.at(-1) ?? '';
    pool = pool.filter((id) => id !== byeTeam);
    result.push({
      key: `s-${round}-bye`,
      round,
      team1Id: byeTeam,
      team2Id: null,
      score1: null,
      score2: null,
      winnerId: byeTeam,
    });
  }

  const pairs: [string, string][] = [];
  const used = new Set<string>();
  for (const team of pool) {
    if (used.has(team)) continue;
    const rest = pool.filter((id) => id !== team && !used.has(id));
    const opponent = rest.find((id) => !played.has(`${team}|${id}`)) ?? rest[0];
    if (!opponent) break;
    used.add(team);
    used.add(opponent);
    pairs.push([team, opponent]);
  }
  pairs.forEach(([t1, t2], i) =>
    result.push({
      key: `s-${round}-${i + 1}`,
      round,
      team1Id: t1,
      team2Id: t2,
      score1: null,
      score2: null,
      winnerId: null,
    }),
  );
  return result;
}

function createSwiss(seededTeamIds: string[]): SwissState {
  const state: SwissState = {
    kind: 'swiss',
    teamIds: seededTeamIds,
    rounds: Math.max(1, Math.ceil(Math.log2(seededTeamIds.length))),
    matches: [],
  };
  state.matches = pairSwissRound(state, 1);
  return state;
}

function reportSwiss(
  state: SwissState,
  key: string,
  winnerId: string,
  score1: number,
  score2: number,
): SwissState {
  const target = state.matches.find((m) => m.key === key);
  if (!target) throw new Error('Матч не найден в сетке');
  const latestRound = Math.max(...state.matches.map((m) => m.round));
  if (target.winnerId && target.round < latestRound) {
    throw new Error('Пары следующего тура уже построены по этому результату');
  }
  const next: SwissState = {
    ...state,
    matches: state.matches.map((m) => (m.key === key ? { ...m, winnerId, score1, score2 } : m)),
  };
  const current = Math.max(...next.matches.map((m) => m.round));
  const roundDone = next.matches.filter((m) => m.round === current).every((m) => m.winnerId);
  if (roundDone && current < next.rounds) {
    next.matches = [...next.matches, ...pairSwissRound(next, current + 1)];
  }
  return next;
}

// ───────────────────────── Общий интерфейс ─────────────────────────

export async function createBracket(
  format: TournamentFormat,
  seededTeamIds: string[],
): Promise<BracketState> {
  if (format === 'swiss') return createSwiss(seededTeamIds);
  return createElimination(seededTeamIds, format);
}

export function listBracketMatches(state: BracketState): BracketMatch[] {
  if (state.kind === 'elimination') return eliminationMatches(state);
  return state.matches
    .filter((m) => m.team2Id !== null)
    .map((m) => ({
      key: m.key,
      column: `Тур ${m.round}`,
      columnOrder: m.round,
      round: m.round,
      label: `Тур ${m.round}`,
      team1Id: m.team1Id,
      team2Id: m.team2Id,
      state: m.winnerId ? 'finished' : 'ready',
      score1: m.score1,
      score2: m.score2,
      winnerId: m.winnerId,
    }));
}

export async function reportBracketResult(
  state: BracketState,
  key: string,
  winnerId: string,
  score1: number,
  score2: number,
): Promise<BracketState> {
  if (state.kind === 'elimination') return reportElimination(state, key, winnerId, score1, score2);
  return reportSwiss(state, key, winnerId, score1, score2);
}

export function isBracketFinished(state: BracketState): boolean {
  if (state.kind === 'swiss') {
    const lastRound = Math.max(...state.matches.map((m) => m.round));
    return lastRound >= state.rounds && state.matches.every((m) => m.winnerId);
  }
  const matches = eliminationMatches(state);
  return matches.length > 0 && matches.every((m) => m.state === 'finished');
}

/** Таблица побед/поражений и победитель турнира. */
export function bracketStandings(state: BracketState) {
  const matches = listBracketMatches(state);
  const teamIds =
    state.kind === 'swiss' ? state.teamIds : state.data.participant.map((p) => p.name);
  const rows = new Map(teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0 }]));
  for (const m of matches) {
    if (!m.winnerId) continue;
    const loser = m.winnerId === m.team1Id ? m.team2Id : m.team1Id;
    const w = rows.get(m.winnerId);
    if (w) w.wins += 1;
    const l = loser ? rows.get(loser) : undefined;
    if (l) l.losses += 1;
  }
  if (state.kind === 'swiss') {
    for (const m of state.matches) {
      const row = !m.team2Id ? rows.get(m.team1Id) : undefined;
      if (row) row.wins += 1;
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  let winnerTeamId: string | null = null;
  if (isBracketFinished(state)) {
    if (state.kind === 'swiss') {
      winnerTeamId = sorted[0]?.teamId ?? null;
    } else {
      const last = [...matches].sort((a, b) => b.columnOrder - a.columnOrder)[0];
      winnerTeamId = last?.winnerId ?? null;
    }
  }
  return { rows: sorted, winnerTeamId };
}
