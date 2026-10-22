import { z } from 'zod';
import { cs2RoleSchema, dota2RoleSchema, fpvRoleSchema } from './games';

export const PITCH_MAX_LENGTH = 300;
export const CLIPS_MAX_COUNT = 5;
export const LANGUAGES = ['ru', 'en'] as const;

const commonProfileFields = {
  availability: z.string().trim().max(200),
  hasMic: z.boolean(),
  languages: z.array(z.enum(LANGUAGES)).min(1),
  pitch: z.string().trim().max(PITCH_MAX_LENGTH),
  clips: z.array(z.url({ protocol: /^https$/ })).max(CLIPS_MAX_COUNT),
};

/**
 * Поля анкеты, которые заполняет сам игрок. Рейтинг, ранг, часы и репутацию
 * сайт подставляет сам, вручную они не редактируются.
 */
export const gameProfileInputSchema = z.discriminatedUnion('game', [
  z.object({
    game: z.literal('dota2'),
    roles: z.array(dota2RoleSchema).min(1),
    ...commonProfileFields,
  }),
  z.object({
    game: z.literal('cs2'),
    roles: z.array(cs2RoleSchema).min(1),
    ...commonProfileFields,
  }),
  z.object({
    game: z.literal('fpv'),
    roles: z.array(fpvRoleSchema).min(1),
    ...commonProfileFields,
  }),
]);
export type GameProfileInput = z.infer<typeof gameProfileInputSchema>;
