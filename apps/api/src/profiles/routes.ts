import {
  CLIPS_MAX_COUNT,
  gameProfileInputSchema,
  gameSchema,
  type LeaderboardRow,
  type PublicProfile,
  type PublicUser,
} from '@kiberdvor/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireParticipant, requireUser } from '../auth/session';
import { userTier } from '../billing/service';
import type { AppContext } from '../context';
import { gameProfiles, ratingHistory, ratings, steamAccounts, users } from '../db/schema';
import { forbidden, notFound } from '../http/errors';
import { ensureRating, reputationOf } from '../rating/service';

/** Бесплатно — одна ссылка на клип, с подпиской «Игрок Pro» — до пяти. */
const FREE_CLIPS = 1;

export function toPublicProfile(p: typeof gameProfiles.$inferSelect): PublicProfile {
  return {
    game: p.game,
    roles: p.roles,
    availability: p.availability,
    hasMic: p.hasMic,
    languages: p.languages,
    pitch: p.pitch,
    clips: p.clips,
    rankInGame: p.rankInGame,
    hoursPlayed: p.hoursPlayed,
  };
}

export const profileRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get('/profiles', async (request) => {
    const user = await requireUser(ctx, request);
    const rows = await ctx.db.select().from(gameProfiles).where(eq(gameProfiles.userId, user.id));
    return rows.map(toPublicProfile);
  });

  app.put('/profiles', { schema: { body: gameProfileInputSchema } }, async (request) => {
    const user = await requireParticipant(ctx, request);
    const input = request.body;
    const tier = await userTier(ctx, user.id);
    const clipLimit = tier === 'free' ? FREE_CLIPS : CLIPS_MAX_COUNT;
    if (input.clips.length > clipLimit) {
      throw forbidden(`Без подписки «Игрок Pro» можно добавить ${FREE_CLIPS} клип`);
    }
    // Ранг и часы берём из внешних API, вручную они не редактируются.
    const info = await ctx.providers[input.game]
      .fetchAccountInfo(user.steamId)
      .catch(() => ({ rankInGame: null, hoursPlayed: null }));
    const values = {
      roles: input.roles,
      availability: input.availability,
      hasMic: input.hasMic,
      languages: input.languages,
      pitch: input.pitch,
      clips: input.clips,
      rankInGame: info.rankInGame,
      hoursPlayed: info.hoursPlayed,
      updatedAt: ctx.now(),
    };
    await ctx.db
      .insert(gameProfiles)
      .values({ userId: user.id, game: input.game, ...values })
      .onConflictDoUpdate({ target: [gameProfiles.userId, gameProfiles.game], set: values });
    await ensureRating(ctx, user.id, input.game, user.steamId);
    return { ok: true };
  });

  app.get(
    '/users/:id',
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (request): Promise<PublicUser> => {
      const [row] = await ctx.db
        .select({ id: users.id, nickname: users.nickname, avatarUrl: steamAccounts.avatarUrl })
        .from(users)
        .leftJoin(steamAccounts, eq(steamAccounts.userId, users.id))
        .where(eq(users.id, request.params.id));
      if (!row) throw notFound('Игрок не найден');
      const [userRatings, profiles, rep] = await Promise.all([
        ctx.db.select().from(ratings).where(eq(ratings.userId, row.id)),
        ctx.db.select().from(gameProfiles).where(eq(gameProfiles.userId, row.id)),
        reputationOf(ctx.db, [row.id]),
      ]);
      return {
        ...row,
        ratings: userRatings.map((r) => ({
          game: r.game,
          rating: Math.round(r.rating),
          rd: Math.round(r.rd),
          matches: r.matches,
        })),
        profiles: profiles.map(toPublicProfile),
        reputation: rep(row.id),
      };
    },
  );

  app.get(
    '/leaderboard/:game',
    { schema: { params: z.object({ game: gameSchema }) } },
    async (request): Promise<LeaderboardRow[]> => {
      const rows = await ctx.db
        .select({
          userId: ratings.userId,
          nickname: users.nickname,
          avatarUrl: steamAccounts.avatarUrl,
          rating: ratings.rating,
          rd: ratings.rd,
          matches: ratings.matches,
        })
        .from(ratings)
        .innerJoin(users, eq(users.id, ratings.userId))
        .leftJoin(steamAccounts, eq(steamAccounts.userId, users.id))
        .where(eq(ratings.game, request.params.game))
        .orderBy(desc(ratings.rating))
        .limit(100);
      return rows.map((r) => ({ ...r, rating: Math.round(r.rating), rd: Math.round(r.rd) }));
    },
  );

  /** История рейтинга — функция подписки «Игрок Pro». */
  app.get(
    '/me/rating-history/:game',
    { schema: { params: z.object({ game: gameSchema }) } },
    async (request) => {
      const user = await requireUser(ctx, request);
      if ((await userTier(ctx, user.id)) === 'free')
        throw forbidden('История рейтинга доступна с подпиской «Игрок Pro»');
      const rows = await ctx.db
        .select({ rating: ratingHistory.rating, at: ratingHistory.createdAt })
        .from(ratingHistory)
        .where(and(eq(ratingHistory.userId, user.id), eq(ratingHistory.game, request.params.game)))
        .orderBy(asc(ratingHistory.createdAt));
      return rows.map((r) => ({ rating: Math.round(r.rating), at: r.at.toISOString() }));
    },
  );
};
