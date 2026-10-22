import { z } from 'zod';

export const RESULT_SOURCES = ['api', 'client', 'organizer'] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];

export const HOST_TYPES = ['neutral', 'player'] as const;
export type HostType = (typeof HOST_TYPES)[number];

export const dotaMatchInputSchema = z.object({
  externalMatchId: z.string().regex(/^\d{6,12}$/),
});

/** Кандидат в хосты CS2: десктоп-клиент открыл порт и ждёт проверки. */
export const hostCandidateInputSchema = z.object({
  port: z.int().min(1024).max(65535),
  neutral: z.boolean().default(false),
});

export const pingReportInputSchema = z.object({
  pings: z
    .array(z.object({ candidateUserId: z.uuid(), rttMs: z.number().min(0).max(5000).nullable() }))
    .max(20),
});

export const hostConfirmInputSchema = z.object({
  candidateUserId: z.uuid(),
});

export const hostLaunchedInputSchema = z.object({
  /** Адрес, по которому игроки подключаются: ip:port. */
  connect: z.string().max(64),
});

export const fpvSubmissionInputSchema = z.object({
  score: z.int().min(0).max(1_000_000),
  /** PNG в base64 без префикса data:, до ~3 МБ. */
  screenshotBase64: z.string().max(4_000_000),
  /** Запись залёта остаётся у игрока, на сайт уходит только хеш (как демо в CS2). */
  recordingSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const manualResultInputSchema = z.object({
  winnerTeamId: z.uuid(),
  score1: z.int().min(0).max(1_000_000),
  score2: z.int().min(0).max(1_000_000),
  /** Кто не явился на матч — уходит в репутацию. */
  noShowUserIds: z.array(z.uuid()).max(10).default([]),
});

export const disputeInputSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});

export const resolveDisputeInputSchema = z.object({
  resolution: z.string().trim().min(2).max(1000),
  result: manualResultInputSchema.optional(),
});

export const reviewInputSchema = z.object({
  reviews: z.array(z.object({ toUserId: z.uuid(), score: z.int().min(1).max(5) })).max(10),
});

/**
 * Событие MatchZy (matchzy_remote_log_url). Формат — Get5-совместимые события;
 * нам нужен только итог серии, остальные события принимаем и игнорируем.
 */
export const matchzyEventSchema = z.looseObject({
  event: z.string(),
  matchid: z.union([z.string(), z.number()]).optional(),
  team1_series_score: z.number().optional(),
  team2_series_score: z.number().optional(),
  winner: z.looseObject({ team: z.string().optional() }).optional(),
  team1: z.looseObject({ score: z.number().optional() }).optional(),
  team2: z.looseObject({ score: z.number().optional() }).optional(),
});
export type MatchzyEvent = z.infer<typeof matchzyEventSchema>;
