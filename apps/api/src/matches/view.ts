import type { MatchView } from '@kiberdvor/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { SessionUser } from '../auth/session';
import type { AppContext } from '../context';
import {
  disputes,
  fpvSubmissions,
  hostCandidates,
  hostPings,
  matchReady,
  matches,
  teamMembers,
  teammateReviews,
  users,
} from '../db/schema';
import { notFound } from '../http/errors';
import { buildTournamentView, getTournament } from '../tournaments/service';
import { recommendHost, scoreCandidates } from './host-selection';

export async function loadMatch(ctx: AppContext, matchId: string) {
  const [match] = await ctx.db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) throw notFound('Матч не найден');
  return match;
}

/** Участники матча по командам. */
export async function matchRoster(ctx: AppContext, match: typeof matches.$inferSelect) {
  const rows = await ctx.db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.tournamentId, match.tournamentId));
  const team1 = rows.filter((r) => r.teamId === match.team1Id).map((r) => r.userId);
  const team2 = rows.filter((r) => r.teamId === match.team2Id).map((r) => r.userId);
  return { team1, team2, all: [...team1, ...team2] };
}

export async function buildMatchView(
  ctx: AppContext,
  match: typeof matches.$inferSelect,
  viewer: SessionUser | null,
): Promise<MatchView> {
  const tournament = await getTournament(ctx.db, match.tournamentId);
  const tView = await buildTournamentView(ctx, tournament, viewer);
  const team1 = tView.teams.find((t) => t.id === match.team1Id) ?? null;
  const team2 = tView.teams.find((t) => t.id === match.team2Id) ?? null;
  const roster = await matchRoster(ctx, match);
  const isParticipant = viewer ? roster.all.includes(viewer.id) : false;
  const isOrganizer = tView.isOrganizer;
  const myTeamId = viewer
    ? roster.team1.includes(viewer.id)
      ? match.team1Id
      : roster.team2.includes(viewer.id)
        ? match.team2Id
        : null
    : null;
  const isCaptain = viewer
    ? team1?.captainId === viewer.id || team2?.captainId === viewer.id
    : false;

  const [ready, candidates, pings, fpv, disputeRows, myReviews] = await Promise.all([
    ctx.db.select().from(matchReady).where(eq(matchReady.matchId, match.id)),
    ctx.db
      .select({ c: hostCandidates, nickname: users.nickname })
      .from(hostCandidates)
      .innerJoin(users, eq(users.id, hostCandidates.userId))
      .where(eq(hostCandidates.matchId, match.id)),
    ctx.db.select().from(hostPings).where(eq(hostPings.matchId, match.id)),
    ctx.db.select().from(fpvSubmissions).where(eq(fpvSubmissions.matchId, match.id)),
    ctx.db
      .select()
      .from(disputes)
      .where(eq(disputes.matchId, match.id))
      .orderBy(asc(disputes.createdAt)),
    viewer
      ? ctx.db
          .select()
          .from(teammateReviews)
          .where(
            and(eq(teammateReviews.matchId, match.id), eq(teammateReviews.fromUserId, viewer.id)),
          )
      : Promise.resolve([]),
  ]);

  const plainCandidates = candidates.map(({ c }) => ({
    userId: c.userId,
    neutral: c.neutral,
    reachable: c.reachable,
  }));
  const scores = scoreCandidates(plainCandidates, pings, roster.all);
  // Лобби и пароль сервера — только участникам и организатору.
  const canSeeSecrets = isParticipant || isOrganizer;

  return {
    id: match.id,
    bracketKey: match.bracketKey,
    label: match.label,
    round: match.round,
    team1Id: match.team1Id,
    team2Id: match.team2Id,
    status: match.status,
    score1: match.score1,
    score2: match.score2,
    winnerTeamId: match.winnerTeamId,
    tournamentId: tournament.id,
    tournamentTitle: tournament.title,
    game: tournament.game,
    team1,
    team2,
    myTeamId,
    isCaptain,
    isOrganizer,
    isParticipant,
    readyUserIds: ready.map((r) => r.userId),
    lobby:
      canSeeSecrets && match.lobbyName && match.lobbyPassword
        ? { name: match.lobbyName, password: match.lobbyPassword }
        : null,
    externalMatchId: match.externalMatchId,
    host: {
      type: match.hostType,
      userId: match.hostUserId,
      connect:
        canSeeSecrets && match.hostConnect
          ? `${match.hostConnect}${match.serverPassword ? `; password ${match.serverPassword}` : ''}`
          : null,
      confirmedBy: match.hostConfirmedBy,
      candidates: candidates.map(({ c, nickname }) => {
        const s = scores.find((x) => x.userId === c.userId);
        return {
          userId: c.userId,
          nickname,
          neutral: c.neutral,
          reachable: c.reachable,
          worstPingMs: s?.worstPingMs ?? null,
          pingCount: s?.pingCount ?? 0,
        };
      }),
      recommendedUserId: recommendHost(plainCandidates, pings, roster.all),
    },
    fpv: fpv.map((f) => ({
      userId: f.userId,
      teamId: f.teamId,
      score: f.score,
      hasScreenshot: f.screenshotPath !== null,
    })),
    resultSource: match.resultSource,
    demoHash: match.demoHash,
    disputes: disputeRows.map((d) => ({
      id: d.id,
      openedBy: d.openedBy,
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      createdAt: d.createdAt.toISOString(),
    })),
    reviewedByMe: myReviews.length > 0,
  };
}
