import { DRAFT_PICK_SECONDS, GAME_INFO } from '@kiberdvor/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context';
import { firstRow } from '../db/client';
import type { DbOrTx } from '../db/client';
import {
  draftPicks,
  drafts,
  freeAgents,
  gameProfiles,
  teamMembers,
  teams,
  tournaments,
} from '../db/schema';
import { badRequest, forbidden } from '../http/errors';
import { lockTournament, notifyNewMatches, syncMatches } from '../matches/service';
import { DEFAULT_RATING } from '../rating/glicko2';
import { ratingsOf } from '../rating/service';
import { startBracket, teamAverages } from '../tournaments/service';
import { buildSnakeOrder, chooseAutoPick, type PoolPlayer } from './draft-logic';

type Tournament = typeof tournaments.$inferSelect;
type NewMatches = Awaited<ReturnType<typeof syncMatches>>;

async function poolOf(db: DbOrTx, tournament: Tournament): Promise<PoolPlayer[]> {
  const agents = await db
    .select()
    .from(freeAgents)
    .where(and(eq(freeAgents.tournamentId, tournament.id), eq(freeAgents.status, 'pool')));
  const ids = agents.map((a) => a.userId);
  if (ids.length === 0) return [];
  const profiles = await db
    .select()
    .from(gameProfiles)
    .where(and(inArray(gameProfiles.userId, ids), eq(gameProfiles.game, tournament.game)));
  const rating = await ratingsOf(db, ids, tournament.game);
  return ids.map((userId) => {
    const profile = profiles.find((p) => p.userId === userId);
    return {
      userId,
      rating: rating.get(userId)?.rating ?? DEFAULT_RATING.rating,
      roles: profile?.roles ?? [],
      reservePriority: profile?.reservePriority ?? false,
    };
  });
}

/**
 * Закрытие регистрации. Если есть свободные агенты и команды с недобором — начинается драфт,
 * иначе сразу строится сетка.
 */
export async function closeRegistration(ctx: AppContext, tournamentId: string) {
  let deadline: Date | null = null;
  let created: NewMatches = [];
  const tournament = await ctx.db.transaction(async (tx) => {
    const t = await lockTournament(tx, tournamentId);
    if (t.status !== 'registration_open') throw badRequest('Регистрация уже закрыта');
    const teamSize = GAME_INFO[t.game].teamSize;
    const averages = await teamAverages(tx, t);
    const pool = await poolOf(tx, t);
    const order = buildSnakeOrder(
      averages.map((a) => ({
        id: a.team.id,
        avgRating: a.avgRating,
        need: teamSize - a.memberCount,
      })),
      pool.length,
    );

    if (order.length === 0) {
      await finishPool(tx, t);
      const started = await startBracket(ctx, tx, t);
      created = await syncMatches(ctx, tx, started);
      return started;
    }

    deadline = new Date(ctx.now().getTime() + DRAFT_PICK_SECONDS * 1000);
    await tx
      .insert(drafts)
      .values({ tournamentId, order, currentPick: 0, deadline, status: 'in_progress' });
    return firstRow(
      await tx
        .update(tournaments)
        .set({ status: 'drafting' })
        .where(eq(tournaments.id, tournamentId))
        .returning(),
    );
  });

  if (deadline) ctx.draftTimers.schedule(tournamentId, deadline);
  ctx.realtime.tournamentChanged(tournamentId);
  await notifyNewMatches(ctx, tournament, created);
  if (deadline) await notifyCurrentCaptain(ctx, tournamentId);
  return tournament;
}

/** Невыбранные остаются в резерве и получают приоритет в следующем драфте. */
async function finishPool(tx: DbOrTx, tournament: Tournament) {
  const leftovers = await tx
    .select({ userId: freeAgents.userId })
    .from(freeAgents)
    .where(and(eq(freeAgents.tournamentId, tournament.id), eq(freeAgents.status, 'pool')));
  if (leftovers.length === 0) return;
  const ids = leftovers.map((l) => l.userId);
  await tx
    .update(freeAgents)
    .set({ status: 'reserve' })
    .where(and(eq(freeAgents.tournamentId, tournament.id), inArray(freeAgents.userId, ids)));
  await tx
    .update(gameProfiles)
    .set({ reservePriority: true })
    .where(and(inArray(gameProfiles.userId, ids), eq(gameProfiles.game, tournament.game)));
}

/**
 * Пик капитана или авто-пик по таймеру. `expectedPick` защищает от гонки:
 * если капитан успел выбрать в последнюю секунду, авто-пик просто ничего не сделает.
 */
export async function makePick(
  ctx: AppContext,
  tournamentId: string,
  pick: { byUserId: string; userId: string } | { auto: true; expectedPick: number },
) {
  let nextDeadline: Date | null = null;
  let created: NewMatches = [];
  const result = await ctx.db.transaction(async (tx) => {
    const t = await lockTournament(tx, tournamentId);
    const [draft] = await tx.select().from(drafts).where(eq(drafts.tournamentId, tournamentId));
    if (!draft || draft.status !== 'in_progress' || t.status !== 'drafting') {
      if ('auto' in pick) return null;
      throw badRequest('Драфт не идёт');
    }
    if ('auto' in pick && draft.currentPick !== pick.expectedPick) return null;

    const teamId = draft.order[draft.currentPick];
    if (!teamId) throw badRequest('Очередь драфта закончилась');
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId));
    const pool = await poolOf(tx, t);

    let chosen: string;
    if ('auto' in pick) {
      const auto = chooseAutoPick(pool, team?.missingRoles ?? []);
      if (!auto) return null;
      chosen = auto.userId;
    } else {
      if (team?.captainId !== pick.byUserId) throw forbidden('Сейчас пикает другой капитан');
      if (!pool.some((p) => p.userId === pick.userId))
        throw badRequest('Этого игрока уже нет в пуле');
      chosen = pick.userId;
    }

    await tx.insert(teamMembers).values({ teamId, tournamentId, userId: chosen, viaDraft: true });
    await tx
      .update(freeAgents)
      .set({ status: 'picked' })
      .where(and(eq(freeAgents.tournamentId, tournamentId), eq(freeAgents.userId, chosen)));
    await tx
      .update(gameProfiles)
      .set({ reservePriority: false })
      .where(and(eq(gameProfiles.userId, chosen), eq(gameProfiles.game, t.game)));
    await tx.insert(draftPicks).values({
      tournamentId,
      pickNo: draft.currentPick + 1,
      teamId,
      userId: chosen,
      auto: 'auto' in pick,
    });

    const nextPick = draft.currentPick + 1;
    const poolLeft = pool.length - 1;
    if (nextPick >= draft.order.length || poolLeft === 0) {
      await tx
        .update(drafts)
        .set({ status: 'finished', currentPick: nextPick, deadline: null })
        .where(eq(drafts.tournamentId, tournamentId));
      await finishPool(tx, t);
      const started = await startBracket(ctx, tx, t);
      created = await syncMatches(ctx, tx, started);
      return { tournament: started, chosen, finished: true };
    }

    nextDeadline = new Date(ctx.now().getTime() + DRAFT_PICK_SECONDS * 1000);
    await tx
      .update(drafts)
      .set({ currentPick: nextPick, deadline: nextDeadline })
      .where(eq(drafts.tournamentId, tournamentId));
    return { tournament: t, chosen, finished: false };
  });

  if (!result) return null;
  if (nextDeadline) ctx.draftTimers.schedule(tournamentId, nextDeadline);
  else ctx.draftTimers.cancel(tournamentId);
  ctx.realtime.tournamentChanged(tournamentId);
  await ctx.notifier.notify([result.chosen], {
    text: `Вас выбрали в команду в турнире «${result.tournament.title}»`,
    link: `/tournaments/${tournamentId}`,
  });
  if (result.finished) await notifyNewMatches(ctx, result.tournament, created);
  else await notifyCurrentCaptain(ctx, tournamentId);
  return result;
}

async function notifyCurrentCaptain(ctx: AppContext, tournamentId: string) {
  const [draft] = await ctx.db.select().from(drafts).where(eq(drafts.tournamentId, tournamentId));
  const teamId = draft?.order[draft.currentPick];
  if (!teamId) return;
  const [team] = await ctx.db.select().from(teams).where(eq(teams.id, teamId));
  if (team) {
    await ctx.notifier.notify([team.captainId], {
      text: `Ваш пик в драфте: на выбор ${DRAFT_PICK_SECONDS} секунд`,
      link: `/tournaments/${tournamentId}`,
    });
  }
}

/** Таймеры пиков живут в памяти процесса; после перезапуска восстанавливаются из БД. */
export function createDraftTimers(getCtx: () => AppContext) {
  const timers = new Map<string, NodeJS.Timeout>();

  const fire = async (tournamentId: string) => {
    timers.delete(tournamentId);
    const ctx = getCtx();
    const [draft] = await ctx.db.select().from(drafts).where(eq(drafts.tournamentId, tournamentId));
    if (!draft || draft.status !== 'in_progress') return;
    if (draft.deadline && draft.deadline.getTime() > ctx.now().getTime() + 50) {
      api.schedule(tournamentId, draft.deadline);
      return;
    }
    await makePick(ctx, tournamentId, { auto: true, expectedPick: draft.currentPick }).catch(
      (error: unknown) => console.error('Авто-пик не удался', tournamentId, error),
    );
  };

  const api = {
    schedule(tournamentId: string, deadline: Date) {
      api.cancel(tournamentId);
      const delay = Math.max(0, deadline.getTime() - Date.now());
      timers.set(
        tournamentId,
        setTimeout(() => void fire(tournamentId), delay),
      );
    },
    cancel(tournamentId: string) {
      const timer = timers.get(tournamentId);
      if (timer) clearTimeout(timer);
      timers.delete(tournamentId);
    },
    async resume(ctx: AppContext) {
      const running = await ctx.db.select().from(drafts).where(eq(drafts.status, 'in_progress'));
      for (const d of running) api.schedule(d.tournamentId, d.deadline ?? new Date());
    },
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
  return api;
}
