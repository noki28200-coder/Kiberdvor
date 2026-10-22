import {
  antiCheatReportSchema,
  disputeInputSchema,
  dotaMatchInputSchema,
  fpvSubmissionInputSchema,
  GAME_INFO,
  hostCandidateInputSchema,
  hostConfirmInputSchema,
  hostLaunchedInputSchema,
  manualResultInputSchema,
  matchzyEventSchema,
  pingReportInputSchema,
  resolveDisputeInputSchema,
  reviewInputSchema,
  type HostTask,
} from '@kiberdvor/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { currentUser, requireParticipant, requireUser, type SessionUser } from '../auth/session';
import type { AppContext } from '../context';
import { humanCode, randomToken, sha256 } from '../crypto';
import {
  disputes,
  fpvSubmissions,
  hostCandidates,
  hostPings,
  matchReady,
  matches,
  steamAccounts,
  teamMembers,
  teammateReviews,
  teams,
  tournaments,
  users,
} from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { bumpReputation } from '../rating/service';
import { getTournament } from '../tournaments/service';
import { buildMatchzyConfig, MATCHZY_TOKEN_HEADER, seriesResult } from './matchzy';
import { recordResult } from './service';
import { buildMatchView, loadMatch, matchRoster } from './view';

const idParams = z.object({ id: z.uuid() });
type Match = typeof matches.$inferSelect;

/** Капитаны обеих команд матча. */
async function captainsOf(ctx: AppContext, match: Match) {
  const ids = [match.team1Id, match.team2Id].filter((id): id is string => id !== null);
  const rows = ids.length
    ? await ctx.db
        .select({ id: teams.id, captainId: teams.captainId })
        .from(teams)
        .where(inArray(teams.id, ids))
    : [];
  return rows.map((r) => r.captainId);
}

async function isOrganizerOf(ctx: AppContext, match: Match, user: SessionUser) {
  const tournament = await getTournament(ctx.db, match.tournamentId);
  return tournament.organizerId === user.id || user.isAdmin;
}

async function assertParticipant(ctx: AppContext, match: Match, user: SessionUser) {
  const roster = await matchRoster(ctx, match);
  if (!roster.all.includes(user.id)) throw forbidden('Вы не участвуете в этом матче');
  return roster;
}

function assertOpen(match: Match) {
  if (match.status === 'finished') throw conflict('Матч уже завершён');
}

/** SteamID участников по командам — для проверки состава через API игры и для MatchZy. */
async function rosterSteam(ctx: AppContext, match: Match) {
  const rows = await ctx.db
    .select({
      teamId: teamMembers.teamId,
      steamId: steamAccounts.steamId,
      nickname: users.nickname,
    })
    .from(teamMembers)
    .innerJoin(steamAccounts, eq(steamAccounts.userId, teamMembers.userId))
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.tournamentId, match.tournamentId));
  return {
    team1: rows.filter((r) => r.teamId === match.team1Id),
    team2: rows.filter((r) => r.teamId === match.team2Id),
  };
}

export const matchRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const uploadDir = resolve(ctx.env.UPLOAD_DIR);

  app.get('/matches/:id', { schema: { params: idParams } }, async (request) => {
    const match = await loadMatch(ctx, request.params.id);
    return buildMatchView(ctx, match, await currentUser(ctx, request));
  });

  /** Незавершённые матчи пользователя — для уведомлений на сайте и в десктоп-клиенте. */
  app.get('/me/matches', async (request) => {
    const user = await requireUser(ctx, request);
    const memberships = await ctx.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id));
    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length === 0) return [];
    const rows = await ctx.db
      .select({ m: matches, tournamentTitle: tournaments.title, game: tournaments.game })
      .from(matches)
      .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
      .where(and(ne(matches.status, 'finished')));
    return rows
      .filter(
        ({ m }) =>
          (m.team1Id && teamIds.includes(m.team1Id)) || (m.team2Id && teamIds.includes(m.team2Id)),
      )
      .map(({ m, tournamentTitle, game }) => ({
        id: m.id,
        tournamentId: m.tournamentId,
        tournamentTitle,
        game,
        label: m.label,
        status: m.status,
        isHost: m.hostUserId === user.id,
      }));
  });

  app.post('/matches/:id/ready', { schema: { params: idParams } }, async (request) => {
    const user = await requireUser(ctx, request);
    const match = await loadMatch(ctx, request.params.id);
    assertOpen(match);
    const roster = await assertParticipant(ctx, match, user);
    await ctx.db
      .insert(matchReady)
      .values({ matchId: match.id, userId: user.id })
      .onConflictDoNothing();
    const ready = await ctx.db.select().from(matchReady).where(eq(matchReady.matchId, match.id));
    if (
      match.status === 'scheduled' &&
      roster.all.every((id) => ready.some((r) => r.userId === id))
    ) {
      await ctx.db.update(matches).set({ status: 'live' }).where(eq(matches.id, match.id));
    }
    ctx.realtime.matchChanged(match.id, match.tournamentId);
    return { ok: true };
  });

  // ───────── Dota 2: капитан вводит ID матча, сайт проверяет его через OpenDota ─────────

  app.post(
    '/matches/:id/external-match',
    { schema: { params: idParams, body: dotaMatchInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      assertOpen(match);
      const tournament = await getTournament(ctx.db, match.tournamentId);
      const provider = ctx.providers[tournament.game];
      if (provider.resultMode !== 'external_id' || !provider.verifyExternalMatch) {
        throw badRequest('В этой игре результат приходит другим способом');
      }
      const captains = await captainsOf(ctx, match);
      if (!captains.includes(user.id) && !(await isOrganizerOf(ctx, match, user))) {
        throw forbidden('ID матча вводит капитан или организатор');
      }
      const [usedElsewhere] = await ctx.db
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(eq(matches.externalMatchId, request.body.externalMatchId), ne(matches.id, match.id)),
        );
      if (usedElsewhere) throw conflict('Этот матч уже засчитан в другой встрече');

      const sides = await rosterSteam(ctx, match);
      const verification = await provider.verifyExternalMatch(request.body.externalMatchId, {
        team1SteamIds: sides.team1.map((p) => p.steamId),
        team2SteamIds: sides.team2.map((p) => p.steamId),
      });
      if (!verification.ok) throw badRequest(verification.reason);
      const { team1Won, score1, score2 } = verification;
      if (!match.team1Id || !match.team2Id) throw badRequest('В матче нет соперника');
      await recordResult(ctx, match.id, {
        winnerTeamId: team1Won ? match.team1Id : match.team2Id,
        score1,
        score2,
        source: 'api',
        externalMatchId: request.body.externalMatchId,
      });
      return { ok: true };
    },
  );

  // ───────── CS2: выбор хоста среди ПК игроков и нейтральных ПК ─────────

  app.post(
    '/matches/:id/host-candidates',
    { schema: { params: idParams, body: hostCandidateInputSchema } },
    async (request) => {
      const user = await requireParticipant(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (match.status !== 'host_selection') throw badRequest('Хост для этого матча уже выбран');
      const organizer = await isOrganizerOf(ctx, match, user);
      if (request.body.neutral && !organizer) {
        throw forbidden('Нейтральный ПК регистрирует организатор турнира');
      }
      if (!request.body.neutral) await assertParticipant(ctx, match, user);
      // Доступность порта проверяем сами: ПК с серым IP в хосты не предлагаем.
      const reachable = await ctx.checkPort(request.ip, request.body.port);
      const values = {
        ip: request.ip,
        port: request.body.port,
        neutral: request.body.neutral,
        reachable,
      };
      await ctx.db
        .insert(hostCandidates)
        .values({ matchId: match.id, userId: user.id, ...values })
        .onConflictDoUpdate({
          target: [hostCandidates.matchId, hostCandidates.userId],
          set: values,
        });
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      return { reachable };
    },
  );

  /** Кандидаты с адресами — только участникам, чтобы их клиенты померили пинг. */
  app.get('/matches/:id/host-candidates', { schema: { params: idParams } }, async (request) => {
    const user = await requireUser(ctx, request);
    const match = await loadMatch(ctx, request.params.id);
    await assertParticipant(ctx, match, user);
    const rows = await ctx.db
      .select()
      .from(hostCandidates)
      .where(and(eq(hostCandidates.matchId, match.id), eq(hostCandidates.reachable, true)));
    return rows.map((r) => ({ userId: r.userId, ip: r.ip, port: r.port }));
  });

  app.post(
    '/matches/:id/pings',
    { schema: { params: idParams, body: pingReportInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      await assertParticipant(ctx, match, user);
      for (const ping of request.body.pings) {
        await ctx.db
          .insert(hostPings)
          .values({
            matchId: match.id,
            fromUserId: user.id,
            candidateUserId: ping.candidateUserId,
            rttMs: ping.rttMs,
          })
          .onConflictDoUpdate({
            target: [hostPings.matchId, hostPings.fromUserId, hostPings.candidateUserId],
            set: { rttMs: ping.rttMs },
          });
      }
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      return { ok: true };
    },
  );

  /** Хост выбран, когда его подтвердили оба капитана (или организатор). */
  app.post(
    '/matches/:id/host/confirm',
    { schema: { params: idParams, body: hostConfirmInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (match.status !== 'host_selection') throw badRequest('Хост уже выбран');
      const captains = await captainsOf(ctx, match);
      const organizer = await isOrganizerOf(ctx, match, user);
      if (!captains.includes(user.id) && !organizer) throw forbidden('Хоста подтверждают капитаны');
      const [candidate] = await ctx.db
        .select()
        .from(hostCandidates)
        .where(
          and(
            eq(hostCandidates.matchId, match.id),
            eq(hostCandidates.userId, request.body.candidateUserId),
          ),
        );
      if (!candidate?.reachable)
        throw badRequest('Этот ПК недоступен из интернета и не может быть хостом');

      const sameHost = match.hostUserId === candidate.userId;
      const confirmedBy = sameHost ? [...new Set([...match.hostConfirmedBy, user.id])] : [user.id];
      const agreed = organizer || captains.every((c) => confirmedBy.includes(c));
      await ctx.db
        .update(matches)
        .set({
          hostUserId: candidate.userId,
          hostType: candidate.neutral ? 'neutral' : 'player',
          hostConfirmedBy: confirmedBy,
          ...(agreed ? { status: 'ready_check' as const, serverPassword: humanCode(8) } : {}),
        })
        .where(eq(matches.id, match.id));
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      if (agreed) {
        await ctx.notifier.notify([candidate.userId], {
          text: `Вы хост матча «${match.label}». Десктоп-клиент развернёт сервер CS2.`,
          link: `/matches/${match.id}`,
          matchId: match.id,
        });
      }
      return { agreed };
    },
  );

  /**
   * Задание для десктоп-клиента хоста. Каждый вызов выпускает новый одноразовый токен
   * (старый перестаёт действовать); токен сгорает, когда MatchZy присылает итог серии.
   */
  app.get(
    '/matches/:id/host-task',
    { schema: { params: idParams } },
    async (request): Promise<HostTask> => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (match.hostUserId !== user.id) throw forbidden('Вы не хост этого матча');
      if (match.status !== 'ready_check' && match.status !== 'live')
        throw badRequest('Матч не ждёт сервер');
      if (match.tokenUsedAt) throw conflict('Результат матча уже получен');
      const token = randomToken();
      await ctx.db
        .update(matches)
        .set({ tokenHash: sha256(token) })
        .where(eq(matches.id, match.id));
      return {
        matchId: match.id,
        configUrl: `${ctx.env.PUBLIC_URL}/api/matches/${match.id}/matchzy-config?token=${token}`,
        serverPassword: match.serverPassword ?? '',
        remoteLogHeaderValue: token,
      };
    },
  );

  app.get(
    '/matches/:id/matchzy-config',
    { schema: { params: idParams, querystring: z.object({ token: z.string().min(20) }) } },
    async (request) => {
      const match = await loadMatch(ctx, request.params.id);
      if (
        !match.tokenHash ||
        match.tokenHash !== sha256(request.query.token) ||
        match.tokenUsedAt
      ) {
        throw forbidden('Неверный или использованный токен матча');
      }
      const tournament = await getTournament(ctx.db, match.tournamentId);
      const [team1] = match.team1Id
        ? await ctx.db.select().from(teams).where(eq(teams.id, match.team1Id))
        : [];
      const [team2] = match.team2Id
        ? await ctx.db.select().from(teams).where(eq(teams.id, match.team2Id))
        : [];
      const sides = await rosterSteam(ctx, match);
      const players = (list: typeof sides.team1) =>
        Object.fromEntries(list.map((p) => [p.steamId, p.nickname]));
      return buildMatchzyConfig({
        matchId: match.id,
        team1: { name: team1?.name ?? 'Команда 1', players: players(sides.team1) },
        team2: { name: team2?.name ?? 'Команда 2', players: players(sides.team2) },
        playersPerTeam: GAME_INFO[tournament.game].teamSize,
        remoteLogUrl: `${ctx.env.PUBLIC_URL}/api/integrations/matchzy`,
        token: request.query.token,
        serverPassword: match.serverPassword ?? '',
      });
    },
  );

  app.post(
    '/matches/:id/host-launched',
    { schema: { params: idParams, body: hostLaunchedInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (match.hostUserId !== user.id) throw forbidden('Вы не хост этого матча');
      await ctx.db
        .update(matches)
        .set({ hostConnect: request.body.connect, status: 'live' })
        .where(eq(matches.id, match.id));
      const roster = await matchRoster(ctx, match);
      await ctx.notifier.notify(roster.all, {
        text: `Сервер матча «${match.label}» запущен: connect ${request.body.connect}`,
        link: `/matches/${match.id}`,
        matchId: match.id,
      });
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      return { ok: true };
    },
  );

  /**
   * События MatchZy с сервера на ПК хоста. Авторизация — одноразовый токен матча в заголовке.
   * Итог серии принимается ровно один раз: повторное использование токена — отказ.
   */
  app.post('/integrations/matchzy', { schema: { body: matchzyEventSchema } }, async (request) => {
    const token = request.headers[MATCHZY_TOKEN_HEADER.toLowerCase()];
    if (typeof token !== 'string' || token.length < 20) throw forbidden('Нет токена матча');
    const [match] = await ctx.db
      .select()
      .from(matches)
      .where(eq(matches.tokenHash, sha256(token)));
    if (!match) throw forbidden('Неверный токен матча');

    const event = request.body;
    if (event.event === 'kiberdvor_demo_hash' && typeof event['sha256'] === 'string') {
      if (/^[a-f0-9]{64}$/.test(event['sha256'])) {
        await ctx.db
          .update(matches)
          .set({ demoHash: event['sha256'] })
          .where(and(eq(matches.id, match.id), isNull(matches.demoHash)));
      }
      return { ok: true };
    }

    const result = seriesResult(event);
    if (!result) return { ok: true };
    const [claimed] = await ctx.db
      .update(matches)
      .set({ tokenUsedAt: ctx.now() })
      .where(and(eq(matches.id, match.id), isNull(matches.tokenUsedAt)))
      .returning({ id: matches.id });
    if (!claimed) throw conflict('Токен матча уже использован');
    if (!match.team1Id || !match.team2Id) throw badRequest('В матче нет соперника');
    await recordResult(ctx, match.id, {
      winnerTeamId: result.team1Won ? match.team1Id : match.team2Id,
      score1: result.score1,
      score2: result.score2,
      source: 'client',
    });
    return { ok: true };
  });

  // ───────── FPV: каждый присылает очки и скриншот, команда = сумма ─────────

  app.post(
    '/matches/:id/fpv',
    { schema: { params: idParams, body: fpvSubmissionInputSchema }, bodyLimit: 6 * 1024 * 1024 },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      assertOpen(match);
      const tournament = await getTournament(ctx.db, match.tournamentId);
      if (ctx.providers[tournament.game].resultMode !== 'submissions') {
        throw badRequest('В этой игре очки не присылают вручную');
      }
      const roster = await assertParticipant(ctx, match, user);
      const teamId = roster.team1.includes(user.id) ? match.team1Id : match.team2Id;
      if (!teamId) throw badRequest('Команда не найдена');

      const png = Buffer.from(request.body.screenshotBase64, 'base64');
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        throw badRequest('Скриншот должен быть PNG');
      await mkdir(uploadDir, { recursive: true });
      const fileName = `fpv-${match.id}-${user.id}.png`;
      await writeFile(join(uploadDir, fileName), png);

      const values = {
        teamId,
        score: request.body.score,
        screenshotPath: fileName,
        recordingSha256: request.body.recordingSha256 ?? null,
      };
      await ctx.db
        .insert(fpvSubmissions)
        .values({ matchId: match.id, userId: user.id, ...values })
        .onConflictDoUpdate({
          target: [fpvSubmissions.matchId, fpvSubmissions.userId],
          set: values,
        });

      const submissions = await ctx.db
        .select()
        .from(fpvSubmissions)
        .where(eq(fpvSubmissions.matchId, match.id));
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      if (
        roster.all.every((id) => submissions.some((s) => s.userId === id)) &&
        match.team1Id &&
        match.team2Id
      ) {
        const sum = (t: string) =>
          submissions.filter((s) => s.teamId === t).reduce((acc, s) => acc + s.score, 0);
        const score1 = sum(match.team1Id);
        const score2 = sum(match.team2Id);
        if (score1 !== score2) {
          await recordResult(ctx, match.id, {
            winnerTeamId: score1 > score2 ? match.team1Id : match.team2Id,
            score1,
            score2,
            source: 'client',
          });
        } else {
          // Ничья по очкам — решает организатор.
          await ctx.db
            .update(matches)
            .set({ status: 'awaiting_result' })
            .where(eq(matches.id, match.id));
        }
      }
      return { ok: true };
    },
  );

  app.get(
    '/matches/:id/fpv/:userId/screenshot',
    { schema: { params: z.object({ id: z.uuid(), userId: z.uuid() }) } },
    async (request, reply) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      const roster = await matchRoster(ctx, match);
      if (!roster.all.includes(user.id) && !(await isOrganizerOf(ctx, match, user)))
        throw forbidden();
      const [row] = await ctx.db
        .select()
        .from(fpvSubmissions)
        .where(
          and(
            eq(fpvSubmissions.matchId, match.id),
            eq(fpvSubmissions.userId, request.params.userId),
          ),
        );
      if (!row?.screenshotPath) throw notFound('Скриншота нет');
      return reply.type('image/png').send(await readFile(join(uploadDir, row.screenshotPath)));
    },
  );

  // ───────── Организатор, споры, репутация ─────────

  app.post(
    '/matches/:id/result',
    { schema: { params: idParams, body: manualResultInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (!(await isOrganizerOf(ctx, match, user)))
        throw forbidden('Результат вручную ставит организатор');
      const roster = await matchRoster(ctx, match);
      const { noShowUserIds, ...result } = request.body;
      await recordResult(ctx, match.id, { ...result, source: 'organizer', override: true });
      for (const userId of noShowUserIds.filter((id) => roster.all.includes(id))) {
        await bumpReputation(ctx.db, userId, { noShows: 1 });
      }
      return { ok: true };
    },
  );

  app.post(
    '/matches/:id/disputes',
    { schema: { params: idParams, body: disputeInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      await assertParticipant(ctx, match, user);
      const [open] = await ctx.db
        .select({ id: disputes.id })
        .from(disputes)
        .where(and(eq(disputes.matchId, match.id), eq(disputes.status, 'open')));
      if (open) throw conflict('По этому матчу уже открыт спор');
      await ctx.db
        .insert(disputes)
        .values({ matchId: match.id, openedBy: user.id, reason: request.body.reason });
      await ctx.db.update(matches).set({ status: 'disputed' }).where(eq(matches.id, match.id));
      await bumpReputation(ctx.db, user.id, { disputes: 1 });
      const tournament = await getTournament(ctx.db, match.tournamentId);
      await ctx.notifier.notify([tournament.organizerId], {
        text: `Спор по матчу «${match.label}» в турнире «${tournament.title}»`,
        link: `/matches/${match.id}`,
        matchId: match.id,
      });
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      return { ok: true };
    },
  );

  app.post(
    '/disputes/:id/resolve',
    { schema: { params: idParams, body: resolveDisputeInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const [dispute] = await ctx.db
        .select()
        .from(disputes)
        .where(eq(disputes.id, request.params.id));
      if (!dispute) throw notFound('Спор не найден');
      if (dispute.status !== 'open') throw conflict('Спор уже закрыт');
      const match = await loadMatch(ctx, dispute.matchId);
      if (!(await isOrganizerOf(ctx, match, user))) throw forbidden('Споры решает организатор');

      if (request.body.result) {
        const { winnerTeamId, score1, score2 } = request.body.result;
        await recordResult(ctx, match.id, {
          winnerTeamId,
          score1,
          score2,
          source: 'organizer',
          override: true,
        });
      } else {
        // Результат оставлен как был: возвращаем матч в его прежнее состояние.
        const status = match.winnerTeamId ? 'finished' : match.hostUserId ? 'live' : 'scheduled';
        await ctx.db.update(matches).set({ status }).where(eq(matches.id, match.id));
      }
      await ctx.db
        .update(disputes)
        .set({ status: 'resolved', resolution: request.body.resolution, resolvedAt: ctx.now() })
        .where(eq(disputes.id, dispute.id));
      ctx.realtime.matchChanged(match.id, match.tournamentId);
      return { ok: true };
    },
  );

  /** Оценка тиммейтов после матча (1–5) — уходит в репутацию. */
  app.post(
    '/matches/:id/reviews',
    { schema: { params: idParams, body: reviewInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      if (match.status !== 'finished') throw badRequest('Оценить тиммейтов можно после матча');
      const roster = await assertParticipant(ctx, match, user);
      const teammates = roster.team1.includes(user.id) ? roster.team1 : roster.team2;
      for (const review of request.body.reviews) {
        if (review.toUserId === user.id || !teammates.includes(review.toUserId)) {
          throw badRequest('Оценивать можно только своих тиммейтов');
        }
      }
      for (const review of request.body.reviews) {
        const [inserted] = await ctx.db
          .insert(teammateReviews)
          .values({
            matchId: match.id,
            fromUserId: user.id,
            toUserId: review.toUserId,
            score: review.score,
          })
          .onConflictDoNothing()
          .returning({ score: teammateReviews.score });
        if (inserted)
          await bumpReputation(ctx.db, review.toUserId, {
            reviewSum: review.score,
            reviewCount: 1,
          });
      }
      return { ok: true };
    },
  );

  /**
   * Отчёт античита от клиента. Сервер не доверяет клиенту: подозрительный вердикт
   * только открывает спор для организатора, результат матча не меняется.
   */
  app.post(
    '/matches/:id/anticheat-report',
    { schema: { params: idParams, body: z.object({ report: antiCheatReportSchema }) } },
    async (request) => {
      const user = await requireUser(ctx, request);
      const match = await loadMatch(ctx, request.params.id);
      await assertParticipant(ctx, match, user);
      if (request.body.report.matchId !== match.id) throw badRequest('Отчёт от другого матча');
      const verdict = await ctx.antiCheat.verifyReport(request.body.report, {
        matchId: match.id,
        userId: user.id,
      });
      if (verdict.status === 'suspicious') {
        const [open] = await ctx.db
          .select({ id: disputes.id })
          .from(disputes)
          .where(and(eq(disputes.matchId, match.id), eq(disputes.status, 'open')));
        if (!open) {
          await ctx.db.insert(disputes).values({
            matchId: match.id,
            openedBy: user.id,
            reason: `Античит: ${verdict.reason}`,
          });
          await ctx.db.update(matches).set({ status: 'disputed' }).where(eq(matches.id, match.id));
          ctx.realtime.matchChanged(match.id, match.tournamentId);
        }
      }
      return { status: verdict.status };
    },
  );
};
