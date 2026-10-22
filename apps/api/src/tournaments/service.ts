import {
  GAME_INFO,
  isOldEnoughFor,
  type BracketColumn,
  type FreeAgentView,
  type MatchSummary,
  type PlayerCard,
  type TeamView,
  type TournamentView,
} from '@kiberdvor/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { SessionUser } from '../auth/session';
import type { AppContext } from '../context';
import { firstRow } from '../db/client';
import type { DbOrTx } from '../db/client';
import {
  draftPicks,
  drafts,
  freeAgents,
  gameProfiles,
  matches,
  steamAccounts,
  teamMembers,
  teams,
  tournaments,
  users,
} from '../db/schema';
import { badRequest, forbidden, notFound } from '../http/errors';
import { toPublicProfile } from '../profiles/routes';
import { DEFAULT_RATING } from '../rating/glicko2';
import { ensureRating, ratingsOf, reputationOf } from '../rating/service';
import { bracketStandings, createBracket, listBracketMatches } from './bracket';
import { seedTeams } from './seeding';

type Tournament = typeof tournaments.$inferSelect;

export async function getTournament(db: DbOrTx, id: string) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!t) throw notFound('Турнир не найден');
  return t;
}

export function assertOrganizer(tournament: Tournament, user: SessionUser) {
  if (tournament.organizerId !== user.id && !user.isAdmin) {
    throw forbidden('Это может сделать только организатор турнира');
  }
}

export function assertRegistrationOpen(ctx: AppContext, tournament: Tournament) {
  if (tournament.status !== 'registration_open' || ctx.now() > tournament.registrationClosesAt) {
    throw badRequest('Регистрация на турнир закрыта');
  }
}

/**
 * Проверки перед заявкой: возраст по маркировке игры (436-ФЗ), анкета по игре,
 * игрок ещё не заявлен в этом турнире. Заодно заводим стартовый рейтинг.
 */
export async function assertCanRegister(
  ctx: AppContext,
  user: SessionUser & { steamId: string },
  tournament: Tournament,
) {
  if (!user.birthDate) throw forbidden('Укажите дату рождения в профиле');
  if (!isOldEnoughFor(tournament.game, new Date(`${user.birthDate}T00:00:00Z`), ctx.now())) {
    throw forbidden(
      `Участие в турнирах по ${GAME_INFO[tournament.game].title} — с ${GAME_INFO[tournament.game].minAge} лет`,
    );
  }
  const [profile] = await ctx.db
    .select({ game: gameProfiles.game })
    .from(gameProfiles)
    .where(and(eq(gameProfiles.userId, user.id), eq(gameProfiles.game, tournament.game)));
  if (!profile)
    throw badRequest(
      `Заполните анкету по ${GAME_INFO[tournament.game].title}: по ней вас будут выбирать капитаны`,
    );

  const [inTeam] = await ctx.db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.tournamentId, tournament.id), eq(teamMembers.userId, user.id)));
  const [agent] = await ctx.db
    .select({ status: freeAgents.status })
    .from(freeAgents)
    .where(and(eq(freeAgents.tournamentId, tournament.id), eq(freeAgents.userId, user.id)));
  if (inTeam || agent) throw badRequest('Вы уже заявлены в этом турнире');

  await ensureRating(ctx, user.id, tournament.game, user.steamId);
}

export async function teamAverages(db: DbOrTx, tournament: Tournament) {
  const teamRows = await db.select().from(teams).where(eq(teams.tournamentId, tournament.id));
  const memberRows = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.tournamentId, tournament.id));
  const rating = await ratingsOf(
    db,
    memberRows.map((m) => m.userId),
    tournament.game,
  );
  return teamRows.map((t) => {
    const members = memberRows.filter((m) => m.teamId === t.id);
    const avg =
      members.length === 0
        ? DEFAULT_RATING.rating
        : members.reduce((s, m) => s + (rating.get(m.userId)?.rating ?? DEFAULT_RATING.rating), 0) /
          members.length;
    return { team: t, memberCount: members.length, avgRating: avg };
  });
}

/**
 * Сетка: посев по среднему рейтингу команды. Команды без игроков не участвуют;
 * неполные команды играют как есть — организатор видит это до старта.
 */
export async function startBracket(ctx: AppContext, tx: DbOrTx, tournament: Tournament) {
  const withRatings = (await teamAverages(tx, tournament)).filter((t) => t.memberCount > 0);
  if (withRatings.length < 2) throw badRequest('Для сетки нужно минимум две команды');
  const seeded = seedTeams(withRatings.map((t) => ({ id: t.team.id, avgRating: t.avgRating })));
  for (const [i, teamId] of seeded.entries()) {
    await tx
      .update(teams)
      .set({ seed: i + 1 })
      .where(eq(teams.id, teamId));
  }
  const bracket = await createBracket(tournament.format, seeded);
  return firstRow(
    await tx
      .update(tournaments)
      .set({ bracket, status: 'in_progress' })
      .where(eq(tournaments.id, tournament.id))
      .returning(),
  );
}

export async function buildTournamentView(
  ctx: AppContext,
  tournament: Tournament,
  viewer: SessionUser | null,
): Promise<TournamentView> {
  const db = ctx.db;
  const [organizer] = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(eq(users.id, tournament.organizerId));
  const teamRows = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournament.id))
    .orderBy(asc(teams.createdAt));
  const memberRows = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.tournamentId, tournament.id))
    .orderBy(asc(teamMembers.joinedAt));
  const agentRows = await db
    .select()
    .from(freeAgents)
    .where(eq(freeAgents.tournamentId, tournament.id))
    .orderBy(asc(freeAgents.joinedAt));

  const userIds = [
    ...new Set([...memberRows.map((m) => m.userId), ...agentRows.map((a) => a.userId)]),
  ];
  const people =
    userIds.length === 0
      ? []
      : await db
          .select({ id: users.id, nickname: users.nickname, avatarUrl: steamAccounts.avatarUrl })
          .from(users)
          .leftJoin(steamAccounts, eq(steamAccounts.userId, users.id))
          .where(inArray(users.id, userIds));
  const profiles =
    userIds.length === 0
      ? []
      : await db
          .select()
          .from(gameProfiles)
          .where(
            and(inArray(gameProfiles.userId, userIds), eq(gameProfiles.game, tournament.game)),
          );
  const ratingMap = await ratingsOf(db, userIds, tournament.game);
  const rep = await reputationOf(db, userIds);

  const card = (userId: string): PlayerCard => {
    const person = people.find((p) => p.id === userId);
    const profile = profiles.find((p) => p.userId === userId);
    return {
      userId,
      nickname: person?.nickname ?? '—',
      avatarUrl: person?.avatarUrl ?? null,
      rating: Math.round(ratingMap.get(userId)?.rating ?? DEFAULT_RATING.rating),
      profile: profile ? toPublicProfile(profile) : null,
      reputation: rep(userId),
    };
  };

  const teamViews: TeamView[] = teamRows.map((t) => {
    const members = memberRows
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ ...card(m.userId), viaDraft: m.viaDraft }));
    const avg = members.length ? members.reduce((s, m) => s + m.rating, 0) / members.length : 0;
    return {
      id: t.id,
      name: t.name,
      captainId: t.captainId,
      missingRoles: t.missingRoles,
      seed: t.seed,
      avgRating: Math.round(avg),
      members,
      ...(viewer && t.captainId === viewer.id ? { inviteCode: t.inviteCode } : {}),
    };
  });

  const reserveFlags = new Map(profiles.map((p) => [p.userId, p.reservePriority]));
  const agentViews: FreeAgentView[] = agentRows.map((a) => ({
    ...card(a.userId),
    status: a.status,
    reservePriority: reserveFlags.get(a.userId) ?? false,
  }));

  const [draft] = await db.select().from(drafts).where(eq(drafts.tournamentId, tournament.id));
  const picks = draft
    ? await db
        .select()
        .from(draftPicks)
        .where(eq(draftPicks.tournamentId, tournament.id))
        .orderBy(asc(draftPicks.pickNo))
    : [];

  const matchRows = await db.select().from(matches).where(eq(matches.tournamentId, tournament.id));
  const bracketMatches = tournament.bracket ? listBracketMatches(tournament.bracket) : [];
  const columns = new Map<string, { order: number; matches: MatchSummary[] }>();
  for (const bm of bracketMatches) {
    const row = matchRows.find((m) => m.bracketKey === bm.key);
    const summary: MatchSummary = {
      id: row?.id ?? '',
      bracketKey: bm.key,
      label: bm.label,
      round: bm.round,
      team1Id: bm.team1Id,
      team2Id: bm.team2Id,
      status: row?.status ?? 'scheduled',
      score1: bm.score1,
      score2: bm.score2,
      winnerTeamId: bm.winnerId,
    };
    const col = columns.get(bm.column) ?? { order: bm.columnOrder, matches: [] };
    col.order = Math.min(col.order, bm.columnOrder);
    col.matches.push(summary);
    columns.set(bm.column, col);
  }
  const bracket: BracketColumn[] = [...columns.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([title, col]) => ({ title, matches: col.matches }));

  // В двойной сетке колонки идут по группам: внутри группы — раунды по порядку.
  if (tournament.format === 'double_elimination') {
    for (const col of bracket) col.matches.sort((a, b) => a.round - b.round);
  }

  const myTeam = viewer ? memberRows.find((m) => m.userId === viewer.id) : undefined;
  const myAgent = viewer ? agentRows.find((a) => a.userId === viewer.id) : undefined;

  return {
    id: tournament.id,
    title: tournament.title,
    game: tournament.game,
    format: tournament.format,
    status: tournament.status,
    teamLimit: tournament.teamLimit,
    registrationClosesAt: tournament.registrationClosesAt.toISOString(),
    startsAt: tournament.startsAt.toISOString(),
    organizer: organizer ?? { id: tournament.organizerId, nickname: '—' },
    isOrganizer: viewer ? viewer.id === tournament.organizerId || viewer.isAdmin : false,
    myTeamId: myTeam?.teamId ?? null,
    myFreeAgentStatus: myAgent?.status ?? null,
    teams: teamViews,
    freeAgents: agentViews,
    draft: draft
      ? {
          status: draft.status,
          order: draft.order,
          currentPick: draft.currentPick,
          deadline: draft.deadline?.toISOString() ?? null,
          picks: picks.map((p) => ({
            pickNo: p.pickNo,
            teamId: p.teamId,
            userId: p.userId,
            auto: p.auto,
          })),
        }
      : null,
    bracket,
    standings: tournament.bracket ? bracketStandings(tournament.bracket).rows : [],
    winnerTeamId: tournament.winnerTeamId,
  };
}
