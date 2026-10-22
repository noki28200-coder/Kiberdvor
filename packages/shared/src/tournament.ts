import { z } from 'zod';
import { gameSchema } from './games';

export const TOURNAMENT_FORMATS = ['single_elimination', 'double_elimination', 'swiss'] as const;
export const tournamentFormatSchema = z.enum(TOURNAMENT_FORMATS);
export type TournamentFormat = z.infer<typeof tournamentFormatSchema>;

export const TOURNAMENT_STATUSES = [
  'draft',
  'registration_open',
  'registration_closed',
  'drafting',
  'in_progress',
  'finished',
  'cancelled',
] as const;
export const tournamentStatusSchema = z.enum(TOURNAMENT_STATUSES);
export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;

export const MATCH_STATUSES = [
  'scheduled',
  'host_selection',
  'ready_check',
  'live',
  'awaiting_result',
  'disputed',
  'finished',
] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

/** Абсолютный предел движка; лимиты тарифов (16 / 128) проверяются отдельно в billing. */
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 128;

export const createTournamentSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    game: gameSchema,
    format: tournamentFormatSchema,
    teamLimit: z.int().min(MIN_TEAMS).max(MAX_TEAMS),
    registrationClosesAt: z.iso.datetime({ offset: true }),
    startsAt: z.iso.datetime({ offset: true }),
  })
  .refine((t) => Date.parse(t.registrationClosesAt) <= Date.parse(t.startsAt), {
    message: 'Регистрация должна закрываться не позже начала турнира',
    path: ['registrationClosesAt'],
  });
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
