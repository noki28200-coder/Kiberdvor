import type { Game, Reputation } from '@kiberdvor/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context';
import { firstRow } from '../db/client';
import type { DbOrTx } from '../db/client';
import { ratingHistory, ratings, reputation } from '../db/schema';
import { DEFAULT_RATING, teamComposite, updateRating, type GlickoGame } from './glicko2';

/** Рейтинг игрока по игре; при первой заявке берём стартовый из ранга в игре. */
export async function ensureRating(ctx: AppContext, userId: string, game: Game, steamId: string) {
  const [existing] = await ctx.db
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.game, game)));
  if (existing) return existing;
  const initial = await ctx.providers[game]
    .initialRating(steamId)
    .catch(() => DEFAULT_RATING.rating);
  await ctx.db
    .insert(ratings)
    .values({
      userId,
      game,
      rating: initial,
      rd: DEFAULT_RATING.rd,
      volatility: DEFAULT_RATING.volatility,
    })
    .onConflictDoNothing();
  // Читаем заново: строку мог создать параллельный запрос.
  return firstRow(
    await ctx.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.game, game))),
  );
}

export async function ratingsOf(db: DbOrTx, userIds: string[], game: Game) {
  if (userIds.length === 0) return new Map<string, typeof ratings.$inferSelect>();
  const rows = await db
    .select()
    .from(ratings)
    .where(and(inArray(ratings.userId, userIds), eq(ratings.game, game)));
  return new Map(rows.map((r) => [r.userId, r]));
}

export async function reputationOf(db: DbOrTx, userIds: string[]) {
  const rows =
    userIds.length === 0
      ? []
      : await db.select().from(reputation).where(inArray(reputation.userId, userIds));
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return (userId: string): Reputation => {
    const r = byUser.get(userId);
    return {
      noShows: r?.noShows ?? 0,
      disputes: r?.disputes ?? 0,
      reviewAvg:
        r && r.reviewCount > 0 ? Math.round((r.reviewSum / r.reviewCount) * 10) / 10 : null,
      reviewCount: r?.reviewCount ?? 0,
    };
  };
}

export async function bumpReputation(
  db: DbOrTx,
  userId: string,
  delta: Partial<{ noShows: number; disputes: number; reviewSum: number; reviewCount: number }>,
) {
  const [row] = await db.select().from(reputation).where(eq(reputation.userId, userId));
  const next = {
    noShows: (row?.noShows ?? 0) + (delta.noShows ?? 0),
    disputes: (row?.disputes ?? 0) + (delta.disputes ?? 0),
    reviewSum: (row?.reviewSum ?? 0) + (delta.reviewSum ?? 0),
    reviewCount: (row?.reviewCount ?? 0) + (delta.reviewCount ?? 0),
  };
  await db
    .insert(reputation)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: reputation.userId, set: next });
}

export interface FinishedTeamMatch {
  matchId: string;
  team1: string[];
  team2: string[];
  team1Score: number;
}

/**
 * Glicko-2: рейтинговый период — один турнир. Пересчёт идёт после финала, поэтому
 * исправление результата по спору до конца турнира не требует отката рейтинга.
 */
export async function applyTournamentRatings(
  db: DbOrTx,
  game: Game,
  finished: FinishedTeamMatch[],
) {
  const players = [...new Set(finished.flatMap((m) => [...m.team1, ...m.team2]))];
  const current = await ratingsOf(db, players, game);
  const get = (id: string) => current.get(id) ?? { ...DEFAULT_RATING, matches: 0 };

  const gamesByPlayer = new Map<string, GlickoGame[]>();
  for (const m of finished) {
    const c1 = teamComposite(m.team1.map(get));
    const c2 = teamComposite(m.team2.map(get));
    for (const p of m.team1) {
      gamesByPlayer.set(p, [
        ...(gamesByPlayer.get(p) ?? []),
        { opponent: c2, score: m.team1Score },
      ]);
    }
    for (const p of m.team2) {
      gamesByPlayer.set(p, [
        ...(gamesByPlayer.get(p) ?? []),
        { opponent: c1, score: 1 - m.team1Score },
      ]);
    }
  }

  for (const [userId, games] of gamesByPlayer) {
    const before = get(userId);
    const after = updateRating(before, games);
    const values = { ...after, matches: before.matches + games.length, updatedAt: new Date() };
    await db
      .insert(ratings)
      .values({ userId, game, ...values })
      .onConflictDoUpdate({ target: [ratings.userId, ratings.game], set: values });
    await db.insert(ratingHistory).values({ userId, game, rating: after.rating });
  }
}
