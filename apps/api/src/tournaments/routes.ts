import {
  createTeamInputSchema,
  createTournamentSchema,
  draftPickInputSchema,
  GAME_INFO,
  GAME_ROLES,
  joinTeamInputSchema,
  type TournamentListItem,
} from '@kiberdvor/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requireParticipant, requireUser } from '../auth/session';
import { assertCanCreateTournament } from '../billing/service';
import type { AppContext } from '../context';
import { humanCode } from '../crypto';
import { firstRow } from '../db/client';
import { freeAgents, teamMembers, teams, tournaments, users } from '../db/schema';
import { closeRegistration, makePick } from '../draft/service';
import { badRequest, forbidden, notFound } from '../http/errors';
import { lockTournament } from '../matches/service';
import {
  assertCanRegister,
  assertOrganizer,
  assertRegistrationOpen,
  buildTournamentView,
  getTournament,
} from './service';

const idParams = z.object({ id: z.uuid() });

export const tournamentRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (
  app,
  { ctx },
) => {
  app.get('/tournaments', async (): Promise<TournamentListItem[]> => {
    const rows = await ctx.db
      .select({ t: tournaments, organizerNickname: users.nickname })
      .from(tournaments)
      .innerJoin(users, eq(users.id, tournaments.organizerId))
      .orderBy(desc(tournaments.createdAt))
      .limit(100);
    const ids = rows.map((r) => r.t.id);
    const teamCounts = ids.length
      ? await ctx.db
          .select({ id: teams.tournamentId, n: count() })
          .from(teams)
          .where(inArray(teams.tournamentId, ids))
          .groupBy(teams.tournamentId)
      : [];
    const agentCounts = ids.length
      ? await ctx.db
          .select({ id: freeAgents.tournamentId, n: count() })
          .from(freeAgents)
          .where(inArray(freeAgents.tournamentId, ids))
          .groupBy(freeAgents.tournamentId)
      : [];
    return rows.map(({ t, organizerNickname }) => ({
      id: t.id,
      title: t.title,
      game: t.game,
      format: t.format,
      status: t.status,
      teamLimit: t.teamLimit,
      teamCount: teamCounts.find((c) => c.id === t.id)?.n ?? 0,
      freeAgentCount: agentCounts.find((c) => c.id === t.id)?.n ?? 0,
      startsAt: t.startsAt.toISOString(),
      organizerNickname,
    }));
  });

  app.post('/tournaments', { schema: { body: createTournamentSchema } }, async (request) => {
    const user = await requireUser(ctx, request);
    if (!user.consentPdAt)
      throw forbidden('Сначала дайте согласие на обработку персональных данных');
    const input = request.body;
    await assertCanCreateTournament(ctx, user.id, input.teamLimit);
    const created = await ctx.db
      .insert(tournaments)
      .values({
        organizerId: user.id,
        title: input.title,
        game: input.game,
        format: input.format,
        teamLimit: input.teamLimit,
        registrationClosesAt: new Date(input.registrationClosesAt),
        startsAt: new Date(input.startsAt),
      })
      .returning({ id: tournaments.id });
    return { id: firstRow(created).id };
  });

  app.get('/tournaments/:id', { schema: { params: idParams } }, async (request) => {
    const tournament = await getTournament(ctx.db, request.params.id);
    return buildTournamentView(ctx, tournament, await currentUser(ctx, request));
  });

  app.post(
    '/tournaments/:id/teams',
    { schema: { params: idParams, body: createTeamInputSchema } },
    async (request) => {
      const user = await requireParticipant(ctx, request);
      const tournament = await getTournament(ctx.db, request.params.id);
      assertRegistrationOpen(ctx, tournament);
      await assertCanRegister(ctx, user, tournament);
      const roles = GAME_ROLES[tournament.game];
      if (request.body.missingRoles.some((r) => !roles.includes(r))) {
        throw badRequest('Указана роль не из этой игры');
      }
      const teamId = await ctx.db.transaction(async (tx) => {
        await lockTournament(tx, tournament.id);
        const [row] = await tx
          .select({ n: count() })
          .from(teams)
          .where(eq(teams.tournamentId, tournament.id));
        if ((row?.n ?? 0) >= tournament.teamLimit)
          throw badRequest('Все места для команд заняты, заявитесь свободным агентом');
        const team = firstRow(
          await tx
            .insert(teams)
            .values({
              tournamentId: tournament.id,
              name: request.body.name,
              captainId: user.id,
              inviteCode: humanCode(8),
              missingRoles: request.body.missingRoles,
            })
            .returning(),
        );
        await tx
          .insert(teamMembers)
          .values({ teamId: team.id, tournamentId: tournament.id, userId: user.id });
        return team.id;
      });
      ctx.realtime.tournamentChanged(tournament.id);
      return { id: teamId };
    },
  );

  app.post('/teams/join', { schema: { body: joinTeamInputSchema } }, async (request) => {
    const user = await requireParticipant(ctx, request);
    const [team] = await ctx.db
      .select()
      .from(teams)
      .where(eq(teams.inviteCode, request.body.inviteCode.toUpperCase()));
    if (!team) throw notFound('Команда с таким кодом не найдена');
    const tournament = await getTournament(ctx.db, team.tournamentId);
    assertRegistrationOpen(ctx, tournament);
    await assertCanRegister(ctx, user, tournament);
    await ctx.db.transaction(async (tx) => {
      await lockTournament(tx, tournament.id);
      const [row] = await tx
        .select({ n: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id));
      if ((row?.n ?? 0) >= GAME_INFO[tournament.game].teamSize)
        throw badRequest('В команде уже полный состав');
      await tx
        .insert(teamMembers)
        .values({ teamId: team.id, tournamentId: tournament.id, userId: user.id });
    });
    ctx.realtime.tournamentChanged(tournament.id);
    return { tournamentId: tournament.id };
  });

  app.post('/tournaments/:id/free-agents', { schema: { params: idParams } }, async (request) => {
    const user = await requireParticipant(ctx, request);
    const tournament = await getTournament(ctx.db, request.params.id);
    assertRegistrationOpen(ctx, tournament);
    await assertCanRegister(ctx, user, tournament);
    await ctx.db.insert(freeAgents).values({ tournamentId: tournament.id, userId: user.id });
    ctx.realtime.tournamentChanged(tournament.id);
    return { ok: true };
  });

  /** Отозвать заявку. Капитан, уходя, распускает команду. */
  app.delete('/tournaments/:id/registration', { schema: { params: idParams } }, async (request) => {
    const user = await requireUser(ctx, request);
    const tournament = await getTournament(ctx.db, request.params.id);
    assertRegistrationOpen(ctx, tournament);
    await ctx.db.transaction(async (tx) => {
      await tx
        .delete(freeAgents)
        .where(and(eq(freeAgents.tournamentId, tournament.id), eq(freeAgents.userId, user.id)));
      const [membership] = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.tournamentId, tournament.id), eq(teamMembers.userId, user.id)));
      if (!membership) return;
      const [team] = await tx.select().from(teams).where(eq(teams.id, membership.teamId));
      if (team?.captainId === user.id) await tx.delete(teams).where(eq(teams.id, team.id));
      else
        await tx
          .delete(teamMembers)
          .where(and(eq(teamMembers.teamId, membership.teamId), eq(teamMembers.userId, user.id)));
    });
    ctx.realtime.tournamentChanged(tournament.id);
    return { ok: true };
  });

  app.post(
    '/tournaments/:id/close-registration',
    { schema: { params: idParams } },
    async (request) => {
      const user = await requireUser(ctx, request);
      assertOrganizer(await getTournament(ctx.db, request.params.id), user);
      await closeRegistration(ctx, request.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/tournaments/:id/draft/pick',
    { schema: { params: idParams, body: draftPickInputSchema } },
    async (request) => {
      const user = await requireUser(ctx, request);
      await makePick(ctx, request.params.id, { byUserId: user.id, userId: request.body.userId });
      return { ok: true };
    },
  );

  app.post('/tournaments/:id/cancel', { schema: { params: idParams } }, async (request) => {
    const user = await requireUser(ctx, request);
    const tournament = await getTournament(ctx.db, request.params.id);
    assertOrganizer(tournament, user);
    if (tournament.status === 'finished') throw badRequest('Турнир уже завершён');
    await ctx.db
      .update(tournaments)
      .set({ status: 'cancelled' })
      .where(eq(tournaments.id, tournament.id));
    ctx.draftTimers.cancel(tournament.id);
    ctx.realtime.tournamentChanged(tournament.id);
    return { ok: true };
  });
};
