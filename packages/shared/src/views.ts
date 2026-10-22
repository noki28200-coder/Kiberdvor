// Ответы API. Входные данные валидируются zod-схемами; ответы формирует наш же бэкенд,
// поэтому здесь только типы.
import type { Tier } from './billing';
import type { Game } from './games';
import type { HostType, ResultSource } from './match';
import type { DraftStatus, FreeAgentStatus } from './registration';
import type { MatchStatus, TournamentFormat, TournamentStatus } from './tournament';

export interface Me {
  id: string;
  nickname: string;
  /** login и email видит только сам пользователь (152-ФЗ). */
  login: string;
  email: string | null;
  birthDate: string | null;
  consentGiven: boolean;
  isAdmin: boolean;
  steam: { steamId: string; personaName: string | null; avatarUrl: string | null } | null;
  tier: Tier;
  tierActiveUntil: string | null;
}

export interface PublicRating {
  game: Game;
  rating: number;
  rd: number;
  matches: number;
}

export interface Reputation {
  noShows: number;
  disputes: number;
  reviewAvg: number | null;
  reviewCount: number;
}

export interface PublicProfile {
  game: Game;
  roles: string[];
  availability: string;
  hasMic: boolean;
  languages: string[];
  pitch: string;
  clips: string[];
  rankInGame: string | null;
  hoursPlayed: number | null;
}

/** Публично: только ник, аватар, рейтинг и анкета — без ПД. */
export interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  ratings: PublicRating[];
  profiles: PublicProfile[];
  reputation: Reputation;
}

export interface PlayerCard {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  rating: number;
  profile: PublicProfile | null;
  reputation: Reputation;
}

export interface TeamView {
  id: string;
  name: string;
  captainId: string;
  missingRoles: string[];
  seed: number | null;
  avgRating: number;
  members: (PlayerCard & { viaDraft: boolean })[];
  /** Код приглашения видит только капитан. */
  inviteCode?: string;
}

export interface FreeAgentView extends PlayerCard {
  status: FreeAgentStatus;
  reservePriority: boolean;
}

export interface DraftView {
  status: DraftStatus;
  order: string[];
  currentPick: number;
  deadline: string | null;
  picks: { pickNo: number; teamId: string; userId: string; auto: boolean }[];
}

export interface MatchSummary {
  id: string;
  bracketKey: string;
  label: string;
  round: number;
  team1Id: string | null;
  team2Id: string | null;
  status: MatchStatus;
  score1: number | null;
  score2: number | null;
  winnerTeamId: string | null;
}

export interface BracketColumn {
  title: string;
  matches: MatchSummary[];
}

export interface StandingRow {
  teamId: string;
  wins: number;
  losses: number;
}

export interface TournamentView {
  id: string;
  title: string;
  game: Game;
  format: TournamentFormat;
  status: TournamentStatus;
  teamLimit: number;
  registrationClosesAt: string;
  startsAt: string;
  organizer: { id: string; nickname: string };
  isOrganizer: boolean;
  myTeamId: string | null;
  myFreeAgentStatus: FreeAgentStatus | null;
  teams: TeamView[];
  freeAgents: FreeAgentView[];
  draft: DraftView | null;
  bracket: BracketColumn[];
  standings: StandingRow[];
  winnerTeamId: string | null;
}

export interface TournamentListItem {
  id: string;
  title: string;
  game: Game;
  format: TournamentFormat;
  status: TournamentStatus;
  teamLimit: number;
  teamCount: number;
  freeAgentCount: number;
  startsAt: string;
  organizerNickname: string;
}

export interface HostCandidateView {
  userId: string;
  nickname: string;
  neutral: boolean;
  reachable: boolean;
  /** Худший пинг среди игроков матча до этого хоста; null — замеров ещё нет. */
  worstPingMs: number | null;
  pingCount: number;
}

export interface MatchView extends MatchSummary {
  tournamentId: string;
  tournamentTitle: string;
  game: Game;
  team1: TeamView | null;
  team2: TeamView | null;
  myTeamId: string | null;
  isCaptain: boolean;
  isOrganizer: boolean;
  isParticipant: boolean;
  readyUserIds: string[];
  lobby: { name: string; password: string } | null;
  externalMatchId: string | null;
  host: {
    type: HostType | null;
    userId: string | null;
    connect: string | null;
    confirmedBy: string[];
    candidates: HostCandidateView[];
    recommendedUserId: string | null;
  };
  fpv: { userId: string; teamId: string; score: number; hasScreenshot: boolean }[];
  resultSource: ResultSource | null;
  demoHash: string | null;
  disputes: {
    id: string;
    openedBy: string;
    reason: string;
    status: 'open' | 'resolved';
    resolution: string | null;
    createdAt: string;
  }[];
  reviewedByMe: boolean;
}

export interface LeaderboardRow {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  rating: number;
  rd: number;
  matches: number;
}

export interface HostTask {
  matchId: string;
  configUrl: string;
  serverPassword: string;
  /** Токен для заголовка MatchZy: одноразовый, сгорает на итоге серии. */
  remoteLogHeaderValue: string;
}
