// Модель данных платформы: пользователи, анкеты, турниры, драфт, матчи, рейтинг, подписка.
import type {
  Game,
  MatchStatus,
  Tier,
  TournamentFormat,
  TournamentStatus,
} from '@kiberdvor/shared';
import type { DraftStatus, FreeAgentStatus, HostType, ResultSource } from '@kiberdvor/shared';
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BracketState } from '../tournaments/bracket';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Один Яндекс ID — один пользователь. */
  yandexId: text('yandex_id').notNull().unique(),
  login: text('login').notNull(),
  nickname: text('nickname').notNull(),
  email: text('email'),
  birthDate: date('birth_date'),
  consentPdAt: timestamp('consent_pd_at', { withTimezone: true }),
  isAdmin: boolean('is_admin').notNull().default(false),
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  telegramChatId: text('telegram_chat_id'),
  telegramLinkCode: text('telegram_link_code').unique(),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  /** sha256 от токена из куки: сам токен в БД не храним. */
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** «Один человек = один аккаунт»: оба поля уникальны на уровне БД. */
export const steamAccounts = pgTable('steam_accounts', {
  steamId: text('steam_id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  personaName: text('persona_name'),
  avatarUrl: text('avatar_url'),
  linkedAt: createdAt(),
});

export const gameProfiles = pgTable(
  'game_profiles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    game: text('game').$type<Game>().notNull(),
    roles: text('roles').array().notNull().default([]),
    availability: text('availability').notNull().default(''),
    hasMic: boolean('has_mic').notNull().default(false),
    languages: text('languages').array().notNull().default([]),
    pitch: text('pitch').notNull().default(''),
    clips: text('clips').array().notNull().default([]),
    rankInGame: text('rank_in_game'),
    hoursPlayed: integer('hours_played'),
    /** Не выбран в прошлом драфте — в следующем идёт первым. */
    reservePriority: boolean('reserve_priority').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] })],
);

export const ratings = pgTable(
  'ratings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    game: text('game').$type<Game>().notNull(),
    rating: real('rating').notNull(),
    rd: real('rd').notNull(),
    volatility: real('volatility').notNull(),
    matches: integer('matches').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.game] })],
);

export const ratingHistory = pgTable('rating_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  game: text('game').$type<Game>().notNull(),
  matchId: uuid('match_id'),
  rating: real('rating').notNull(),
  createdAt: createdAt(),
});

export const reputation = pgTable('reputation', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  noShows: integer('no_shows').notNull().default(0),
  disputes: integer('disputes').notNull().default(0),
  reviewSum: integer('review_sum').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
});

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizerId: uuid('organizer_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  game: text('game').$type<Game>().notNull(),
  format: text('format').$type<TournamentFormat>().notNull(),
  teamLimit: integer('team_limit').notNull(),
  registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  status: text('status').$type<TournamentStatus>().notNull().default('registration_open'),
  bracket: jsonb('bracket').$type<BracketState>(),
  winnerTeamId: uuid('winner_team_id'),
  createdAt: createdAt(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  captainId: uuid('captain_id')
    .notNull()
    .references(() => users.id),
  inviteCode: text('invite_code').notNull().unique(),
  missingRoles: text('missing_roles').array().notNull().default([]),
  seed: integer('seed'),
  createdAt: createdAt(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    viaDraft: boolean('via_draft').notNull().default(false),
    joinedAt: createdAt(),
  },
  // Игрок может быть только в одной команде турнира.
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), unique().on(t.tournamentId, t.userId)],
);

export const freeAgents = pgTable(
  'free_agents',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<FreeAgentStatus>().notNull().default('pool'),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

export const drafts = pgTable('drafts', {
  tournamentId: uuid('tournament_id')
    .primaryKey()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  status: text('status').$type<DraftStatus>().notNull().default('in_progress'),
  order: jsonb('order').$type<string[]>().notNull(),
  currentPick: integer('current_pick').notNull().default(0),
  deadline: timestamp('deadline', { withTimezone: true }),
});

export const draftPicks = pgTable(
  'draft_picks',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    pickNo: integer('pick_no').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    auto: boolean('auto').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.pickNo] })],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    bracketKey: text('bracket_key').notNull(),
    label: text('label').notNull(),
    round: integer('round').notNull(),
    team1Id: uuid('team1_id').references(() => teams.id),
    team2Id: uuid('team2_id').references(() => teams.id),
    status: text('status').$type<MatchStatus>().notNull().default('scheduled'),
    lobbyName: text('lobby_name'),
    lobbyPassword: text('lobby_password'),
    hostType: text('host_type').$type<HostType>(),
    hostUserId: uuid('host_user_id').references(() => users.id),
    hostConfirmedBy: uuid('host_confirmed_by').array().notNull().default([]),
    hostConnect: text('host_connect'),
    serverPassword: text('server_password'),
    /** sha256 одноразового токена матча; сам токен знает только хост. */
    tokenHash: text('token_hash'),
    tokenUsedAt: timestamp('token_used_at', { withTimezone: true }),
    externalMatchId: text('external_match_id'),
    score1: integer('score1'),
    score2: integer('score2'),
    winnerTeamId: uuid('winner_team_id'),
    resultSource: text('result_source').$type<ResultSource>(),
    demoHash: text('demo_hash'),
    ratingApplied: boolean('rating_applied').notNull().default(false),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [unique().on(t.tournamentId, t.bracketKey)],
);

export const matchReady = pgTable(
  'match_ready',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);

export const hostCandidates = pgTable(
  'host_candidates',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Публичный адрес из запроса. Это не ПД пользователя сайта, но наружу его не отдаём. */
    ip: text('ip').notNull(),
    port: integer('port').notNull(),
    neutral: boolean('neutral').notNull().default(false),
    reachable: boolean('reachable').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);

export const hostPings = pgTable(
  'host_pings',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id),
    candidateUserId: uuid('candidate_user_id')
      .notNull()
      .references(() => users.id),
    rttMs: real('rtt_ms'),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.fromUserId, t.candidateUserId] })],
);

export const fpvSubmissions = pgTable(
  'fpv_submissions',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    score: integer('score').notNull(),
    screenshotPath: text('screenshot_path'),
    recordingSha256: text('recording_sha256'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  openedBy: uuid('opened_by')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
  resolution: text('resolution'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const teammateReviews = pgTable(
  'teammate_reviews',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id),
    score: integer('score').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.fromUserId, t.toUserId] })],
);

/** Подписка. Оплата — заглушка: ЮKassa не подключена, платёж помечается как stub. */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tier: text('tier').$type<Tier>().notNull(),
  status: text('status').$type<'active' | 'cancelled'>().notNull().default('active'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  paymentId: text('payment_id').notNull(),
  createdAt: createdAt(),
});
