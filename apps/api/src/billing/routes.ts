import { subscribeInputSchema, TIER_INFO, TIERS } from '@kiberdvor/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { randomToken } from '../crypto';
import { subscriptions } from '../db/schema';
import { notFound } from '../http/errors';
import { activeSubscription } from './service';

const PERIOD_DAYS = 30;

/**
 * Подписка. ЮKassa пока не подключена (решение Артема): «оплата» — заглушка, которая
 * сразу активирует тариф на 30 дней. Платёж помечается id вида stub-…, чек не формируется.
 * При подключении ЮKassa здесь появятся создание платежа и вебхук (54-ФЗ: онлайн-чек).
 */
export const billingRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get('/billing/tiers', async () => TIERS.map((tier) => ({ tier, ...TIER_INFO[tier] })));

  app.get('/billing/me', async (request) => {
    const user = await requireUser(ctx, request);
    const sub = await activeSubscription(ctx, user.id);
    return {
      tier: sub?.tier ?? 'free',
      periodEnd: sub?.periodEnd.toISOString() ?? null,
      autoRenew: sub?.autoRenew ?? false,
      paymentProvider: 'stub' as const,
    };
  });

  app.post('/billing/subscribe', { schema: { body: subscribeInputSchema } }, async (request) => {
    const user = await requireUser(ctx, request);
    const current = await activeSubscription(ctx, user.id);
    const start = current && current.tier === request.body.tier ? current.periodEnd : ctx.now();
    const periodEnd = new Date(start.getTime() + PERIOD_DAYS * 24 * 3600 * 1000);
    if (current && current.tier !== request.body.tier) {
      await ctx.db
        .update(subscriptions)
        .set({ status: 'cancelled', periodEnd: ctx.now() })
        .where(eq(subscriptions.id, current.id));
    }
    await ctx.db.insert(subscriptions).values({
      userId: user.id,
      tier: request.body.tier,
      periodEnd,
      paymentId: `stub-${randomToken(12)}`,
    });
    return { ok: true, periodEnd: periodEnd.toISOString(), paymentProvider: 'stub' as const };
  });

  /** Отмена автопродления: тариф действует до конца оплаченного периода. */
  app.post('/billing/cancel', async (request) => {
    const user = await requireUser(ctx, request);
    const [sub] = await ctx.db
      .update(subscriptions)
      .set({ autoRenew: false })
      .where(and(eq(subscriptions.userId, user.id), gt(subscriptions.periodEnd, ctx.now())))
      .returning({ id: subscriptions.id });
    if (!sub) throw notFound('Активной подписки нет');
    return { ok: true };
  });
};
