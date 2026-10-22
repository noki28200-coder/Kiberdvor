// Демо-данные для показа и ручной проверки: `pnpm --filter api seed`.
// Работает только с DEV_AUTH=true и ходит через настоящие маршруты API (все проверки соблюдаются).
import { noopServerAntiCheat, type MatchView, type TournamentView } from '@kiberdvor/shared';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { createDb } from '../db/client';
import { tournaments, users } from '../db/schema';
import { loadEnv } from '../env';
import { createFpvProvider } from '../games/fpv';
import type { GameProviders } from '../games';
import { createGameProviders } from '../games';

const env = loadEnv();
if (!env.DEV_AUTH) throw new Error('Сид работает только с DEV_AUTH=true');

const database = createDb(env.DATABASE_URL);
await database.migrate();

// Демо-игроки с выдуманными SteamID: внешние API для них не дёргаем.
const real = createGameProviders(env).providers;
const offline = (p: GameProviders[keyof GameProviders]) => ({
  ...p,
  fetchAccountInfo: async () => ({ rankInGame: null, hoursPlayed: null }),
  initialRating: async () => 1300 + Math.round(Math.random() * 500),
});
const { app } = await buildApp({
  env: { ...env, NODE_ENV: 'test' },
  db: database.db,
  pingDb: database.ping,
  antiCheat: noopServerAntiCheat,
  overrides: {
    providers: { dota2: offline(real.dota2), cs2: offline(real.cs2), fpv: createFpvProvider() },
  },
});
await app.ready();

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('demo')]).toString(
  'base64',
);
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
let steamSeq = 900;

const ROLES = { dota2: ['pos1', 'pos2', 'pos3', 'pos4', 'pos5'], fpv: ['pilot', 'scout'] } as const;
const PITCHES = [
  'Держу линию и не тильтую',
  'Играю от карты, много варды',
  'Шотколлер, люблю командную игру',
  'Быстрые руки, слабый английский',
  'Ищу постоянную команду на сезон',
];

async function player(login: string, game?: 'dota2' | 'fpv', index = 0) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { login } });
  const sid = res.cookies.find((c) => c.name === 'sid')?.value ?? '';
  const call = async <T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
  ) => {
    const r = await app.inject({
      method,
      url: `/api${url}`,
      cookies: { sid },
      ...(payload ? { payload } : {}),
    });
    if (r.statusCode >= 400 && !url.includes('dev-steam'))
      throw new Error(`${method} ${url}: ${r.body}`);
    return r.json<T>();
  };
  await call('POST', '/me/consent', { acceptPd: true, acceptTerms: true, nickname: login });
  steamSeq += 1;
  await call('POST', '/auth/dev-steam', {
    steamId: `7656119800000${String(steamSeq).padStart(4, '0')}`,
  });
  if (game) {
    const roles = ROLES[game];
    await call('PUT', '/profiles', {
      game,
      roles: [roles[index % roles.length]],
      availability: index % 2 ? 'будни после 19:00' : 'выходные',
      hasMic: index % 3 !== 0,
      languages: ['ru'],
      pitch: PITCHES[index % PITCHES.length],
      clips: [],
    });
  }
  const me = await call<{ id: string }>('GET', '/me');
  return { id: me.id, call };
}

const [existing] = await database.db
  .select({ id: tournaments.id })
  .from(tournaments)
  .innerJoin(users, eq(users.id, tournaments.organizerId))
  .where(eq(users.yandexId, 'dev:artem'));
if (existing) {
  console.log('Демо-данные уже есть, пропускаю.');
} else {
  // 1. Завершённый FPV-турнир: появится рейтинг и таблица лидеров.
  const fpvOrg = await player('fpv_club');
  const fpv = await fpvOrg.call<{ id: string }>('POST', '/tournaments', {
    title: 'Демо: FPV-кубок клуба',
    game: 'fpv',
    format: 'single_elimination',
    teamLimit: 4,
    registrationClosesAt: days(1),
    startsAt: days(2),
  });
  const fpvPlayers = [];
  for (let t = 0; t < 4; t += 1) {
    const captain = await player(`pilot_${t}_0`, 'fpv', t);
    await captain.call('POST', `/tournaments/${fpv.id}/teams`, {
      name: `Дрон-${t + 1}`,
      missingRoles: [],
    });
    const view = await captain.call<TournamentView>('GET', `/tournaments/${fpv.id}`);
    const code = view.teams.find((x) => x.captainId === captain.id)?.inviteCode;
    fpvPlayers.push(captain);
    for (let i = 1; i < 3; i += 1) {
      const p = await player(`pilot_${t}_${i}`, 'fpv', t + i);
      await p.call('POST', '/teams/join', { inviteCode: code });
      fpvPlayers.push(p);
    }
  }
  await fpvOrg.call('POST', `/tournaments/${fpv.id}/close-registration`);
  for (let guard = 0; guard < 10; guard += 1) {
    const view = await fpvOrg.call<TournamentView>('GET', `/tournaments/${fpv.id}`);
    if (view.status === 'finished') break;
    const ready = view.bracket
      .flatMap((c) => c.matches)
      .filter((m) => m.id && m.status !== 'finished');
    for (const m of ready) {
      const match = await fpvOrg.call<MatchView>('GET', `/matches/${m.id}`);
      const members = [...(match.team1?.members ?? []), ...(match.team2?.members ?? [])];
      for (const member of members) {
        const p = fpvPlayers.find((x) => x.id === member.userId);
        const onTeam1 = match.team1?.members.some((x) => x.userId === member.userId) ?? false;
        await p?.call('POST', `/matches/${m.id}/fpv`, {
          score: (onTeam1 ? 400 : 250) + Math.round(Math.random() * 200),
          screenshotBase64: PNG,
        });
      }
    }
  }

  // 2. Dota 2 с открытой регистрацией. Организатор — artem: можно самому закрыть регистрацию и смотреть драфт.
  const artem = await player('artem', 'dota2', 0);
  const dota = await artem.call<{ id: string }>('POST', '/tournaments', {
    title: 'Демо: Кубок Dota 2',
    game: 'dota2',
    format: 'double_elimination',
    teamLimit: 8,
    registrationClosesAt: days(3),
    startsAt: days(4),
  });
  const teamSizes = [5, 4, 3, 2];
  for (const [t, size] of teamSizes.entries()) {
    const captain = await player(`dota_cap_${t}`, 'dota2', t);
    const missing = ROLES.dota2.slice(size);
    await captain.call('POST', `/tournaments/${dota.id}/teams`, {
      name: ['Рошан', 'Аегис', 'Крипы', 'Варды'][t],
      missingRoles: missing,
    });
    const view = await captain.call<TournamentView>('GET', `/tournaments/${dota.id}`);
    const code = view.teams.find((x) => x.captainId === captain.id)?.inviteCode;
    for (let i = 1; i < size; i += 1) {
      await (
        await player(`dota_${t}_${i}`, 'dota2', t + i)
      ).call('POST', '/teams/join', { inviteCode: code });
    }
  }
  for (let i = 0; i < 7; i += 1) {
    await (
      await player(`solo_${i}`, 'dota2', i)
    ).call('POST', `/tournaments/${dota.id}/free-agents`);
  }
  console.log('Готово. Войдите тестовым входом как artem (организатор Dota-турнира).');
  console.log(
    'Капитаны: dota_cap_1, dota_cap_2, dota_cap_3 — их можно открыть в других браузерах для драфта.',
  );
}

await app.close();
await database.close();
