import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { ServerAntiCheat } from '@kiberdvor/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authRoutes } from './auth/routes';
import { SESSION_COOKIE, userIdFromToken } from './auth/session';
import { billingRoutes } from './billing/routes';
import { tcpCheck, type AppContext } from './context';
import type { Db } from './db/client';
import { createDraftTimers } from './draft/service';
import type { Env } from './env';
import { createGameProviders, type GameProviders } from './games';
import { registerErrorHandler } from './http/errors';
import { matchRoutes } from './matches/routes';
import { Notifier } from './notifications/notifier';
import { Realtime } from './notifications/realtime';
import { setupTelegram } from './notifications/telegram';
import { profileRoutes } from './profiles/routes';
import { healthRoute } from './routes/health';
import { tournamentRoutes } from './tournaments/routes';

export interface AppDeps {
  env: Env;
  db: Db;
  pingDb: () => Promise<boolean>;
  antiCheat: ServerAntiCheat;
  logger?: boolean;
  /** Подмена внешних зависимостей в тестах. */
  overrides?: Partial<Pick<AppContext, 'checkPort' | 'now'>> & { providers?: GameProviders };
}

export async function buildApp({
  env,
  db,
  pingDb,
  antiCheat,
  logger = false,
  overrides = {},
}: AppDeps) {
  const app = Fastify({
    logger: logger && {
      // ПД в логи не пишем (152-ФЗ): заголовки с куками и токенами скрываем.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-match-token"]'],
    },
    // За nginx в production реальный IP клиента приходит в X-Forwarded-For.
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  const realtime = new Realtime();
  const games = createGameProviders(env);
  const draftTimers = createDraftTimers(() => ctx);
  const ctx: AppContext = {
    env,
    db,
    providers: overrides.providers ?? games.providers,
    steam: games.steam,
    realtime,
    notifier: new Notifier(db, realtime, env.PUBLIC_URL),
    antiCheat,
    now: overrides.now ?? (() => new Date()),
    checkPort: overrides.checkPort ?? tcpCheck,
    draftTimers,
  };

  await app.register(cookie);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(healthRoute, { prefix: '/api', pingDb });
  for (const routes of [authRoutes, profileRoutes, tournamentRoutes, matchRoutes, billingRoutes]) {
    await app.register(routes, { prefix: '/api', ctx });
  }

  realtime.attach(app.server, async (cookieHeader) => {
    const token = cookieHeader ? app.parseCookie(cookieHeader)[SESSION_COOKIE] : undefined;
    return userIdFromToken(ctx, token);
  });
  const bot = env.NODE_ENV === 'test' ? null : await setupTelegram(ctx, app);

  app.addHook('onReady', async () => {
    await draftTimers.resume(ctx);
  });
  app.addHook('onClose', async () => {
    draftTimers.clear();
    await realtime.close();
    await bot?.stop();
  });

  return { app, ctx };
}
