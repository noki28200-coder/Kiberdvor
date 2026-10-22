import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // .env необязателен, DATABASE_URL может прийти из окружения.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Пустая строка в .env = не задано, как в src/env.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://kiberdvor:kiberdvor@localhost:5432/kiberdvor',
  },
  strict: true,
});
