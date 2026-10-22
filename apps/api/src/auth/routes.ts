import {
  authConfigSchema,
  consentInputSchema,
  devLoginInputSchema,
  devSteamInputSchema,
  type Me,
} from '@kiberdvor/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activeSubscription } from '../billing/service';
import type { AppContext } from '../context';
import { humanCode, randomToken } from '../crypto';
import { firstRow } from '../db/client';
import { steamAccounts, users } from '../db/schema';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../http/errors';
import { createSession, destroySession, requireUser, type SessionUser } from './session';
import { steamLoginUrl, verifySteamCallback } from './steam-openid';
import { exchangeYandexCode, yandexAuthorizeUrl } from './yandex';

const STATE_COOKIE = 'oauth_state';

async function toMe(ctx: AppContext, user: SessionUser): Promise<Me> {
  const [steam] = user.steamId
    ? await ctx.db.select().from(steamAccounts).where(eq(steamAccounts.steamId, user.steamId))
    : [];
  const sub = await activeSubscription(ctx, user.id);
  return {
    id: user.id,
    nickname: user.nickname,
    login: user.login,
    email: user.email,
    birthDate: user.birthDate,
    consentGiven: user.consentPdAt !== null,
    isAdmin: user.isAdmin,
    steam: steam
      ? { steamId: steam.steamId, personaName: steam.personaName, avatarUrl: steam.avatarUrl }
      : null,
    tier: sub?.tier ?? 'free',
    tierActiveUntil: sub ? sub.periodEnd.toISOString() : null,
  };
}

/** Пользователь по Яндекс ID: создаём при первом входе, ПД берём по минимуму. */
async function upsertYandexUser(
  ctx: AppContext,
  data: { yandexId: string; login: string; email: string | null; birthDate: string | null },
) {
  const [existing] = await ctx.db.select().from(users).where(eq(users.yandexId, data.yandexId));
  if (existing) {
    await ctx.db
      .update(users)
      .set({
        login: data.login,
        email: data.email,
        birthDate: existing.birthDate ?? data.birthDate,
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }
  const created = firstRow(
    await ctx.db
      .insert(users)
      .values({ ...data, nickname: data.login })
      .returning({ id: users.id }),
  );
  return created.id;
}

async function linkSteam(ctx: AppContext, userId: string, steamId: string) {
  const summary = await ctx.steam.playerSummary(steamId);
  try {
    await ctx.db.insert(steamAccounts).values({
      steamId,
      userId,
      personaName: summary?.personaName ?? null,
      avatarUrl: summary?.avatarUrl ?? null,
    });
  } catch (error) {
    // Уникальные индексы steam_id и user_id: один Steam — один Яндекс ID (защита от смурфов).
    if (isUniqueViolation(error)) {
      throw conflict(
        'Этот Steam-аккаунт уже привязан к другому пользователю или у вас уже есть Steam',
      );
    }
    throw error;
  }
}

export const authRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { env } = ctx;
  const yandex =
    env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET
      ? { clientId: env.YANDEX_CLIENT_ID, clientSecret: env.YANDEX_CLIENT_SECRET }
      : null;
  const yandexEnabled = yandex !== null;
  const yandexRedirect = `${env.PUBLIC_URL}/api/auth/yandex/callback`;
  const steamReturn = `${env.PUBLIC_URL}/api/auth/steam/callback`;

  app.get('/auth/config', { schema: { response: { 200: authConfigSchema } } }, async () => ({
    yandex: yandexEnabled,
    steam: true,
    dev: env.DEV_AUTH,
  }));

  app.get('/auth/yandex', async (_request, reply) => {
    if (!yandex) throw badRequest('Вход через Яндекс ID ещё не настроен (нет YANDEX_CLIENT_ID)');
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    return reply.redirect(yandexAuthorizeUrl(yandex.clientId, yandexRedirect, state));
  });

  app.get(
    '/auth/yandex/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (!yandex) throw badRequest('Вход через Яндекс ID ещё не настроен');
      if (error || !code) return reply.redirect(`${env.WEB_ORIGIN}/login?error=yandex`);
      if (!state || state !== request.cookies[STATE_COOKIE])
        throw badRequest('Неверный state OAuth');
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      const yandexUser = await exchangeYandexCode(code, yandex.clientId, yandex.clientSecret);
      const userId = await upsertYandexUser(ctx, yandexUser);
      await createSession(ctx, reply, userId);
      return reply.redirect(`${env.WEB_ORIGIN}/onboarding`);
    },
  );

  app.post('/auth/dev-login', { schema: { body: devLoginInputSchema } }, async (request, reply) => {
    if (!env.DEV_AUTH) throw forbidden('Тестовый вход выключен');
    const login = request.body.login.toLowerCase();
    const userId = await upsertYandexUser(ctx, {
      yandexId: `dev:${login}`,
      login,
      email: `${login}@example.test`,
      birthDate: '2000-01-01',
    });
    await createSession(ctx, reply, userId);
    return { ok: true };
  });

  app.post('/auth/logout', async (request, reply) => {
    await destroySession(ctx, request, reply);
    return { ok: true };
  });

  app.get('/me', async (request) => toMe(ctx, await requireUser(ctx, request)));

  app.post('/me/consent', { schema: { body: consentInputSchema } }, async (request) => {
    const user = await requireUser(ctx, request);
    const { birthDate, nickname } = request.body;
    if (!user.birthDate && !birthDate)
      throw badRequest('Укажите дату рождения: она нужна для возрастных ограничений');
    await ctx.db
      .update(users)
      .set({
        nickname,
        consentPdAt: user.consentPdAt ?? ctx.now(),
        birthDate: user.birthDate ?? birthDate ?? null,
      })
      .where(eq(users.id, user.id));
    return { ok: true };
  });

  app.get('/auth/steam', async (request, reply) => {
    await requireUser(ctx, request);
    return reply.redirect(steamLoginUrl(steamReturn, env.PUBLIC_URL));
  });

  app.get(
    '/auth/steam/callback',
    { schema: { querystring: z.record(z.string(), z.string()) } },
    async (request, reply) => {
      const user = await requireUser(ctx, request);
      const steamId = await verifySteamCallback(request.query, steamReturn);
      if (!steamId) return reply.redirect(`${env.WEB_ORIGIN}/onboarding?error=steam`);
      try {
        await linkSteam(ctx, user.id, steamId);
      } catch (error) {
        if (error instanceof Error && 'status' in error) {
          return reply.redirect(`${env.WEB_ORIGIN}/onboarding?error=steam_taken`);
        }
        throw error;
      }
      return reply.redirect(`${env.WEB_ORIGIN}/onboarding`);
    },
  );

  app.post('/auth/dev-steam', { schema: { body: devSteamInputSchema } }, async (request) => {
    if (!env.DEV_AUTH) throw forbidden('Тестовая привязка выключена');
    const user = await requireUser(ctx, request);
    await linkSteam(ctx, user.id, request.body.steamId);
    return { ok: true };
  });

  /** Код для привязки Telegram: пользователь отправляет боту /start <код>. */
  app.post('/me/telegram-link', async (request) => {
    const user = await requireUser(ctx, request);
    if (!env.TELEGRAM_BOT_TOKEN) throw notFound('Telegram-бот не настроен');
    const code = humanCode(10);
    await ctx.db.update(users).set({ telegramLinkCode: code }).where(eq(users.id, user.id));
    return { code, linked: user.telegramChatId !== null };
  });
};
