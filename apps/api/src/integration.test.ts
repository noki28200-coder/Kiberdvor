import type { MatchView, TournamentView } from '@kiberdvor/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drafts, gameProfiles, ratings, users } from './db/schema';
import { makePick } from './draft/service';
import { createHarness, databaseAvailable, type Harness } from './test/harness';

const hasDb = await databaseAvailable();
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fake')]).toString(
  'base64',
);

const inFuture = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

describe.skipIf(!hasDb)('сценарии API (PostgreSQL)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('один Steam нельзя привязать к двум аккаунтам', async () => {
    const a = await h.player('steam_a');
    const b = await h.app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { login: 'steam_b' },
    });
    const sid = b.cookies.find((c) => c.name === 'sid')?.value ?? '';
    const me = await a.call('GET', '/me');
    const steamId = (me.body.steam as { steamId: string }).steamId;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/auth/dev-steam',
      cookies: { sid },
      payload: { steamId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('несовершеннолетнего не пускает на турнир (436-ФЗ), а без Steam — вообще', async () => {
    const org = await h.player('age_org');
    const t = await org.call('POST', '/tournaments', {
      title: 'Возрастной',
      game: 'dota2',
      format: 'single_elimination',
      teamLimit: 4,
      registrationClosesAt: inFuture(1),
      startsAt: inFuture(2),
    });
    const kid = await h.player('kid', 'dota2');
    await h.ctx.db.update(users).set({ birthDate: '2015-01-01' }).where(eq(users.id, kid.id));
    const res = await kid.call('POST', `/tournaments/${t.body.id as string}/free-agents`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/16/);
  });

  it('бесплатный тариф не даёт турнир на 32 команды, подписка-заглушка даёт', async () => {
    const org = await h.player('tier_org');
    const input = {
      title: 'Большой кубок',
      game: 'cs2',
      format: 'double_elimination',
      teamLimit: 32,
      registrationClosesAt: inFuture(1),
      startsAt: inFuture(2),
    };
    expect((await org.call('POST', '/tournaments', input)).status).toBe(403);
    const sub = await org.call('POST', '/billing/subscribe', { tier: 'organizer' });
    expect(sub.status).toBe(200);
    expect((await org.call('POST', '/tournaments', input)).status).toBe(200);
  });

  it('FPV: регистрация, драфт змейкой с авто-пиком, очки игроков, рейтинг', async () => {
    const org = await h.player('fpv_org');
    const created = await org.call('POST', '/tournaments', {
      title: 'FPV-кубок',
      game: 'fpv',
      format: 'single_elimination',
      teamLimit: 4,
      registrationClosesAt: inFuture(1),
      startsAt: inFuture(2),
    });
    const id = created.body.id as string;

    // Команда A: капитан + друг по коду приглашения (не хватает 1). Команда B: только капитан (не хватает 2).
    const capA = await h.player('fpv_cap_a', 'fpv');
    const capB = await h.player('fpv_cap_b', 'fpv');
    const friend = await h.player('fpv_friend', 'fpv');
    await capA.call('POST', `/tournaments/${id}/teams`, { name: 'Альфа', missingRoles: ['scout'] });
    await capB.call('POST', `/tournaments/${id}/teams`, { name: 'Бета', missingRoles: [] });
    const viewA = (await capA.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    const alpha = viewA.teams.find((t) => t.name === 'Альфа');
    expect(alpha?.inviteCode).toBeTruthy();
    expect(
      (await friend.call('POST', '/teams/join', { inviteCode: alpha?.inviteCode })).status,
    ).toBe(200);

    // Четыре свободных агента: трое попадут в команды, один останется в резерве.
    const agents = [];
    for (const login of ['fpv_fa1', 'fpv_fa2', 'fpv_fa3', 'fpv_fa4']) {
      const agent = await h.player(login, 'fpv');
      expect((await agent.call('POST', `/tournaments/${id}/free-agents`)).status).toBe(200);
      agents.push(agent);
    }

    expect((await capA.call('POST', `/tournaments/${id}/close-registration`)).status).toBe(403);
    expect((await org.call('POST', `/tournaments/${id}/close-registration`)).status).toBe(200);

    let view = (await org.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    expect(view.status).toBe('drafting');
    expect(view.draft?.order).toHaveLength(3);

    const captainOf = (teamId: string) =>
      view.teams.find((t) => t.id === teamId)?.captainId === capA.id ? capA : capB;
    const firstTeam = view.draft?.order[0] ?? '';
    const other = captainOf(firstTeam) === capA ? capB : capA;
    const poolIds = () => view.freeAgents.filter((a) => a.status === 'pool').map((a) => a.userId);

    // Чужой капитан не может пикать вне очереди.
    expect(
      (await other.call('POST', `/tournaments/${id}/draft/pick`, { userId: poolIds()[0] })).status,
    ).toBe(403);
    expect(
      (
        await captainOf(firstTeam).call('POST', `/tournaments/${id}/draft/pick`, {
          userId: poolIds()[0],
        })
      ).status,
    ).toBe(200);

    // Второй пик — по таймеру (авто-пик).
    const [draft] = await h.ctx.db.select().from(drafts).where(eq(drafts.tournamentId, id));
    await makePick(h.ctx, id, { auto: true, expectedPick: draft?.currentPick ?? 0 });

    view = (await org.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    const thirdTeam = view.draft?.order[view.draft.currentPick] ?? '';
    expect(
      (
        await captainOf(thirdTeam).call('POST', `/tournaments/${id}/draft/pick`, {
          userId: poolIds()[0],
        })
      ).status,
    ).toBe(200);

    view = (await org.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    expect(view.status).toBe('in_progress');
    expect(view.draft?.picks.filter((p) => p.auto)).toHaveLength(1);
    expect(view.teams.every((t) => t.members.length === 3)).toBe(true);
    const reserve = view.freeAgents.find((a) => a.status === 'reserve');
    expect(reserve).toBeTruthy();
    const [reserveProfile] = await h.ctx.db
      .select()
      .from(gameProfiles)
      .where(eq(gameProfiles.userId, reserve?.userId ?? ''));
    expect(reserveProfile?.reservePriority).toBe(true);

    // Единственный матч: каждый присылает очки со скриншотом.
    const matchId = view.bracket.flatMap((c) => c.matches).find((m) => m.id)?.id ?? '';
    const everyone = [capA, capB, friend, ...agents];
    const match = (await org.call('GET', `/matches/${matchId}`)).body as unknown as MatchView;
    const participants = [...(match.team1?.members ?? []), ...(match.team2?.members ?? [])].map(
      (m) => m.userId,
    );
    for (const p of everyone.filter((e) => participants.includes(e.id))) {
      const onTeam1 = match.team1?.members.some((m) => m.userId === p.id);
      const res = await p.call('POST', `/matches/${matchId}/fpv`, {
        score: onTeam1 ? 300 : 100,
        screenshotBase64: PNG,
      });
      expect(res.status).toBe(200);
    }

    view = (await org.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    expect(view.status).toBe('finished');
    expect(view.winnerTeamId).toBe(match.team1Id);

    const [rating] = await h.ctx.db
      .select()
      .from(ratings)
      .where(eq(ratings.userId, participants[0] ?? ''));
    expect(rating?.matches).toBe(1);
    expect(rating?.rating).not.toBe(1500);

    // Повторно прислать очки в завершённый матч нельзя.
    expect(
      (await capA.call('POST', `/matches/${matchId}/fpv`, { score: 1, screenshotBase64: PNG }))
        .status,
    ).toBe(409);
  });

  it('CS2: выбор хоста капитанами, конфиг MatchZy, счёт по одноразовому токену', async () => {
    const org = await h.player('cs_org');
    const created = await org.call('POST', '/tournaments', {
      title: 'CS2-кубок',
      game: 'cs2',
      format: 'single_elimination',
      teamLimit: 2,
      registrationClosesAt: inFuture(1),
      startsAt: inFuture(2),
    });
    const id = created.body.id as string;
    const capA = await h.player('cs_cap_a', 'cs2');
    const capB = await h.player('cs_cap_b', 'cs2');
    await capA.call('POST', `/tournaments/${id}/teams`, { name: 'Север', missingRoles: [] });
    await capB.call('POST', `/tournaments/${id}/teams`, { name: 'Юг', missingRoles: [] });
    const codes = ((await capA.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView)
      .teams;
    const codeB = (
      (await capB.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView
    ).teams.find((t) => t.name === 'Юг')?.inviteCode;
    const codeA = codes.find((t) => t.name === 'Север')?.inviteCode;
    for (let i = 0; i < 4; i += 1) {
      await (await h.player(`cs_a${i}`, 'cs2')).call('POST', '/teams/join', { inviteCode: codeA });
      await (await h.player(`cs_b${i}`, 'cs2')).call('POST', '/teams/join', { inviteCode: codeB });
    }
    await org.call('POST', `/tournaments/${id}/close-registration`);

    const view = (await org.call('GET', `/tournaments/${id}`)).body as unknown as TournamentView;
    expect(view.status).toBe('in_progress');
    const matchId = view.bracket[0]?.matches[0]?.id ?? '';
    let match = (await capA.call('GET', `/matches/${matchId}`)).body as unknown as MatchView;
    expect(match.status).toBe('host_selection');

    // Капитан A предлагает свой ПК, оба капитана подтверждают.
    expect(
      (
        await capA.call('POST', `/matches/${matchId}/host-candidates`, {
          port: 27015,
          neutral: false,
        })
      ).body.reachable,
    ).toBe(true);
    expect(
      (await capA.call('POST', `/matches/${matchId}/host/confirm`, { candidateUserId: capA.id }))
        .body.agreed,
    ).toBe(false);
    expect(
      (await capB.call('POST', `/matches/${matchId}/host/confirm`, { candidateUserId: capA.id }))
        .body.agreed,
    ).toBe(true);

    // Задание хосту выдаётся только хосту.
    expect((await capB.call('GET', `/matches/${matchId}/host-task`)).status).toBe(403);
    const task = (await capA.call('GET', `/matches/${matchId}/host-task`)).body;
    const token = task.remoteLogHeaderValue as string;
    const config = await h.app.inject({
      method: 'GET',
      url: `/api/matches/${matchId}/matchzy-config?token=${token}`,
    });
    const configJson = config.json<{
      team1: { players: Record<string, string> };
      cvars: Record<string, string>;
    }>();
    expect(Object.keys(configJson.team1.players)).toHaveLength(5);
    expect(configJson.cvars.matchzy_remote_log_header_value).toBe(token);

    // Итог серии от MatchZy.
    const event = {
      event: 'series_end',
      matchid: 1,
      team1_series_score: 1,
      team2_series_score: 0,
      winner: { team: 'team1' },
    };
    const send = () =>
      h.app.inject({
        method: 'POST',
        url: '/api/integrations/matchzy',
        headers: { 'x-match-token': token },
        payload: event,
      });
    expect((await send()).statusCode).toBe(200);
    match = (await capA.call('GET', `/matches/${matchId}`)).body as unknown as MatchView;
    expect(match.status).toBe('finished');
    expect(match.resultSource).toBe('client');
    expect(match.winnerTeamId).toBe(match.team1Id);

    // Повторное использование токена — отказ.
    expect((await send()).statusCode).toBe(409);
    const forged = await h.app.inject({
      method: 'POST',
      url: '/api/integrations/matchzy',
      headers: { 'x-match-token': 'x'.repeat(40) },
      payload: event,
    });
    expect(forged.statusCode).toBe(403);
  });
});
