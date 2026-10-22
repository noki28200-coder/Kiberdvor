import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** Транзакция или сама БД: сервисы принимают любой из вариантов. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db: Db = drizzle(client, { schema });

  return {
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    async ping(): Promise<boolean> {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.end(),
  };
}

export type Database = ReturnType<typeof createDb>;

/** Первая строка результата; пустой результат здесь — ошибка программы, а не пользователя. */
export function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('Запрос не вернул строку');
  return row;
}
