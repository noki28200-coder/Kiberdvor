import { z } from 'zod';

/** Дата в формате YYYY-MM-DD. */
export const isoDateSchema = z.iso.date();

export const consentInputSchema = z.object({
  /** Согласие на обработку ПД (152-ФЗ) обязательно и даётся отдельной галочкой. */
  acceptPd: z.literal(true),
  acceptTerms: z.literal(true),
  /** Нужна, только если Яндекс ID не отдал дату рождения. */
  birthDate: isoDateSchema.optional(),
  nickname: z.string().trim().min(2).max(32),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

/** Вход без Яндекс ID — только для локальной разработки и демо (DEV_AUTH=true). */
export const devLoginInputSchema = z.object({
  login: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{2,32}$/i),
});

export const devSteamInputSchema = z.object({
  steamId: z.string().regex(/^7656\d{13}$/),
});

export const authConfigSchema = z.object({
  yandex: z.boolean(),
  steam: z.boolean(),
  dev: z.boolean(),
});
export type AuthConfig = z.infer<typeof authConfigSchema>;
