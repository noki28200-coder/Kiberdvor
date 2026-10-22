import type { ResultSource } from '@kiberdvor/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { firstRow } from '../db/client';
import { matches, teamMembers, tournaments } from '../db/schema';
import { badRequest, conflict, notFound } from '../http/errors';
import { applyTournamentRatings } from '../rating/service';
import {
  bracketStandings,
  isBracketFinished,
  listBracketMatches,
  reportBracketResult,
} from '../tournaments/bracket';

type Tournament = typeof tournaments.$inferSelect;

export async function lockTournament(tx: DbOrTx, tournamentId: string) {
  const [t] = await tx
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .for('update');
  if (!t) throw notFound('Турнир не найден');
  return t;
}

export async function teamMemberIds(db: DbOrTx, teamIds: string[]) {
  if (teamIds.length === 0) return new Map<string, string[]>();
  const rows = await db.select().from(teamMembers).where(inArray(teamMembers.teamId, teamIds));
  const map = new Map<string, string[]>(teamIds.map((id) => [id, []]));
  for (const r of rows) map.get(r.teamId)?.push(r.userId);
  return map;
}

/**
 * Создаёт строки матчей для пар сетки, у которых уже известны обе команды.
 * Возвращает id новых матчей — их участникам уходит уведомление.
 */
export async function syncMatches(ctx: AppContext, tx: DbOrTx, tournament: Tournament) {
  if (!tournament.bracket) return [];
  const provider = ctx.providers[tournament.game];
  const existing = await tx
    .select({ bracketKey: matches.bracketKey })
    .from(matches)
    .where(eq(matches.tournamentId, tournament.id));
  const known = new Set(existing.map((m) => m.bracketKey));

  const created: { id: string; team1Id: string; team2Id: string }[] = [];
  for (const m of listBracketMatches(tournament.bracket)) {
    if (known.has(m.key) || !m.team1Id || !m.team2Id || m.state === 'pending') continue;
    const lobby = provider.createLobby?.();
    const [row] = await tx
      .insert(matches)
      .values({
        tournamentId: tournament.id,
        bracketKey: m.key,
        label: m.label,
        round: m.round,
        team1Id: m.team1Id,
        team2Id: m.team2Id,
        status: provider.needsHost ? 'host_selection' : 'scheduled',
        lobbyName: lobby?.name ?? null,
        lobbyPassword: lobby?.password ?? null,
      })
      .returning({ id: matches.id });
    if (row) created.push({ id: row.id, team1Id: m.team1Id, team2Id: m.team2Id });
  }
  return created;
}

export async function notifyNewMatches(
  ctx: AppContext,
  tournament: Tournament,
  created: { id: string; team1Id: string; team2Id: string }[],
) {
  const members = await teamMemberIds(
    ctx.db,
    created.flatMap((m) => [m.team1Id, m.team2Id]),
  );
  for (const m of created) {
    const userIds = [...(members.get(m.team1Id) ?? []), ...(members.get(m.team2Id) ?? [])];
    await ctx.notifier.notify(userIds, {
      text: `Ваш матч в турнире «${tournament.title}» готов. Нажмите «Готов» и заходите в игру.`,
      link: `/matches/${m.id}`,
      matchId: m.id,
    });
  }
}

export interface ResultInput {
  winnerTeamId: string;
  score1: number;
  score2: number;
  source: ResultSource;
  externalMatchId?: string;
  /** Организатор меняет уже записанный результат (решение спора). */
  override?: boolean;
}

/**
 * Единая точка записи результата: обновляет сетку, создаёт следующие матчи,
 * завершает турнир и пересчитывает Glicko-2 после финала.
 */
export async function recordResult(ctx: AppContext, matchId: string, input: ResultInput) {
  const outcome = await ctx.db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId));
    if (!match) throw notFound('Матч не найден');
    const tournament = await lockTournament(tx, match.tournamentId);
    if (!tournament.bracket) throw badRequest('Сетка ещё не построена');
    if (tournament.status === 'finished' && !input.override) throw conflict('Турнир уже завершён');
    if (match.status === 'finished' && !input.override)
      throw conflict('Результат матча уже записан');
    if (input.winnerTeamId !== match.team1Id && input.winnerTeamId !== match.team2Id) {
      throw badRequest('Победитель должен быть одной из команд матча');
    }

    let bracket;
    try {
      bracket = await reportBracketResult(
        tournament.bracket,
        match.bracketKey,
        input.winnerTeamId,
        input.score1,
        input.score2,
      );
    } catch {
      throw conflict('Результат нельзя изменить: следующий матч этой команды уже сыгран');
    }

    await tx
      .update(matches)
      .set({
        status: 'finished',
        winnerTeamId: input.winnerTeamId,
        score1: input.score1,
        score2: input.score2,
        resultSource: input.source,
        externalMatchId: input.externalMatchId ?? match.externalMatchId,
        finishedAt: ctx.now(),
      })
      .where(eq(matches.id, matchId));

    const finished = isBracketFinished(bracket);
    const winnerTeamId = finished ? bracketStandings(bracket).winnerTeamId : null;
    const updated = firstRow(
      await tx
        .update(tournaments)
        .set({ bracket, status: finished ? 'finished' : 'in_progress', winnerTeamId })
        .where(eq(tournaments.id, tournament.id))
        .returning(),
    );

    const created = await syncMatches(ctx, tx, updated);
    if (finished && tournament.status !== 'finished') await finishRatings(tx, updated);
    return { tournament: updated, created, finished };
  });

  ctx.realtime.matchChanged(matchId, outcome.tournament.id);
  await notifyNewMatches(ctx, outcome.tournament, outcome.created);
  return outcome;
}

async function finishRatings(tx: DbOrTx, tournament: Tournament) {
  const rows = await tx
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournament.id), eq(matches.status, 'finished')));
  const members = await teamMemberIds(
    tx,
    rows.flatMap((m) => [m.team1Id, m.team2Id].filter((id): id is string => id !== null)),
  );
  await applyTournamentRatings(
    tx,
    tournament.game,
    rows.flatMap((m) =>
      m.team1Id && m.team2Id && m.winnerTeamId
        ? [
            {
              matchId: m.id,
              team1: members.get(m.team1Id) ?? [],
              team2: members.get(m.team2Id) ?? [],
              team1Score: m.winnerTeamId === m.team1Id ? 1 : 0,
            },
          ]
        : [],
    ),
  );
}
