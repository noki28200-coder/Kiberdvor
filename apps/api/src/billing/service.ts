import { TIER_INFO, type Tier } from '@kiberdvor/shared';
import { and, count, desc, eq, gt, gte } from 'drizzle-orm';
import type { AppContext } from '../context';
import { subscriptions, tournaments } from '../db/schema';
import { forbidden } from '../http/errors';

export async function activeSubscription(ctx: AppContext, userId: string) {
  const [sub] = await ctx.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), gt(subscriptions.periodEnd, ctx.now())))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return sub ?? null;
}

export async function userTier(ctx: AppContext, userId: string): Promise<Tier> {
  return (await activeSubscription(ctx, userId))?.tier ?? 'free';
}

/** Лимиты тарифа на создание турнира: число турниров в месяц и размер сетки. */
export async function assertCanCreateTournament(
  ctx: AppContext,
  userId: string,
  teamLimit: number,
) {
  const tier = TIER_INFO[await userTier(ctx, userId)];
  if (teamLimit > tier.maxTeams) {
    throw forbidden(
      `Тариф «${tier.title}» позволяет турниры до ${tier.maxTeams} команд. Больше — на тарифе «Организатор».`,
    );
  }
  if (tier.tournamentsPerMonth !== null) {
    const now = ctx.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [row] = await ctx.db
      .select({ n: count() })
      .from(tournaments)
      .where(and(eq(tournaments.organizerId, userId), gte(tournaments.createdAt, monthStart)));
    if ((row?.n ?? 0) >= tier.tournamentsPerMonth) {
      throw forbidden(
        `На тарифе «${tier.title}» можно создать ${tier.tournamentsPerMonth} турнира в месяц. Без лимита — на тарифе «Организатор».`,
      );
    }
  }
}
