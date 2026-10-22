import { z } from 'zod';

const flag = z
  .enum(['true', 'false', ''])
  .default('false')
  .transform((v) => v === 'true');
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3100),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  /** Адрес, по которому браузер и внешние сервисы видят сайт (колбэки OAuth, MatchZy). */
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.url().default('postgres://kiberdvor:kiberdvor@localhost:5432/kiberdvor'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Вход без Яндекс ID для разработки и демо. В production запрещён. */
  DEV_AUTH: flag,
  YANDEX_CLIENT_ID: optional,
  YANDEX_CLIENT_SECRET: optional,
  STEAM_API_KEY: optional,
  FACEIT_API_KEY: optional,
  /** ЮKassa пока не подключена: подписка оформляется заглушкой. Ключи понадобятся позже. */
  YOOKASSA_SHOP_ID: optional,
  YOOKASSA_SECRET_KEY: optional,
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
});
export type Env = z.infer<typeof envSchema>;

/** Подхватывает .env, если он есть, и проверяет переменные окружения. */
export function loadEnv(): Env {
  try {
    process.loadEnvFile();
  } catch {
    // .env необязателен: на сервере переменные приходят из Docker Compose.
  }
  // Пустая строка в .env = переменная не задана, берётся значение по умолчанию.
  const defined = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Некорректные переменные окружения:\n${z.prettifyError(result.error)}`);
  }
  if (result.data.NODE_ENV === 'production') {
    if (result.data.DEV_AUTH) throw new Error('DEV_AUTH нельзя включать в production');
    if (!process.env.DATABASE_URL) throw new Error('В production задайте DATABASE_URL');
  }
  return result.data;
}
