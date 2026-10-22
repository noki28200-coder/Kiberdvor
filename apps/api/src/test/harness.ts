import { noopServerAntiCheat } from '@kiberdvor/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { buildApp } from '../app';
import { createDb } from '../db/client';
import type { Env } from '../env';
import { createCs2Provider } from '../games/cs2';
import { createDota2Provider } from '../games/dota2';
import { createFpvProvider } from '../games/fpv';
import type { GameProviders } from '../games';
import { createSteamWebApi } from '../games/steam-web-api';

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://kiberdvor:kiberdvor@localhost:5432/kiberdvor';
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://kiberdvor:kiberdvor@localhost:5432/kiberdvor_test';

/** Есть ли локальный PostgreSQL (docker compose up -d). Без него интеграционные тесты пропускаются. */
export async function databaseAvailable(): Promise<boolean> {
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = 'kiberdvor_test'`;
    if (exists.length === 0) await admin.unsafe('create database kiberdvor_test');
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

/** Адаптеры игр без сетевых запросов: стартовый рейтинг 1500, ранга нет. */
function offlineProviders(): GameProviders {
  const steam = createSteamWebApi(undefined);
  const offline = <T extends GameProviders[keyof GameProviders]>(p: T): T => ({
    ...p,
    fetchAccountInfo: async () => ({ rankInGame: null, hoursPlayed: null }),
    initialRating: async () => 1500,
  });
  return {
    dota2: offline(createDota2Provider(steam)),
    cs2: offline(createCs2Provider(steam, undefined)),
    fpv: createFpvProvider(),
  };
}

export async function createHarness() {
  const database = createDb(TEST_URL);
  await database.migrate();
  await database.db.execute(sql`
    do $$ declare r record; begin
      for r in (select tablename from pg_tables where schemaname = 'public') loop
        execute 'truncate table ' || quote_ident(r.tablename) || ' cascade';
      end loop;
    end $$;
  `);

  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 0,
    WEB_ORIGIN: 'http://localhost:5173',
    PUBLIC_URL: 'http://localhost:5173',
    DATABASE_URL: TEST_URL,
    UPLOAD_DIR: `${process.env.TMPDIR ?? '/tmp'}/kiberdvor-test-uploads`,
    DEV_AUTH: true,
    YANDEX_CLIENT_ID: undefined,
    YANDEX_CLIENT_SECRET: undefined,
    STEAM_API_KEY: undefined,
    FACEIT_API_KEY: undefined,
    YOOKASSA_SHOP_ID: undefined,
    YOOKASSA_SECRET_KEY: undefined,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_WEBHOOK_SECRET: undefined,
  };

  const { app, ctx } = await buildApp({
    env,
    db: database.db,
    pingDb: database.ping,
    antiCheat: noopServerAntiCheat,
    overrides: { providers: offlineProviders(), checkPort: async () => true },
  });
  await app.ready();

  let steamCounter = 0;

  /** Пользователь, прошедший онбординг: вход, согласие на ПД, Steam, анкета по игре. */
  async function player(login: string, game?: 'dota2' | 'cs2' | 'fpv') {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { login },
    });
    const sid = loginRes.cookies.find((c) => c.name === 'sid')?.value;
    if (!sid) throw new Error(`dev-login не выдал сессию: ${loginRes.body}`);
    const cookies = { sid };
    const call = async (
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: string,
      payload?: unknown,
    ) => {
      const res = await app.inject({
        method,
        url: `/api${url}`,
        cookies,
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return {
        status: res.statusCode,
        body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {},
      };
    };
    await call('POST', '/me/consent', { acceptPd: true, acceptTerms: true, nickname: login });
    steamCounter += 1;
    await call('POST', '/auth/dev-steam', {
      steamId: `7656119${String(steamCounter).padStart(10, '0')}`,
    });
    if (game) {
      const roles = { dota2: ['pos1'], cs2: ['entry'], fpv: ['pilot'] }[game];
      await call('PUT', '/profiles', {
        game,
        roles,
        availability: 'вечером',
        hasMic: true,
        languages: ['ru'],
        pitch: 'играю стабильно',
        clips: [],
      });
    }
    const me = await call('GET', '/me');
    return { id: me.body.id as string, call };
  }

  return {
    app,
    ctx,
    player,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
