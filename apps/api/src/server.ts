import { loadServerAntiCheat } from './anticheat';
import { buildApp } from './app';
import { createDb } from './db/client';
import { loadEnv } from './env';

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
await database.migrate();
const antiCheat = await loadServerAntiCheat();

const { app } = await buildApp({
  env,
  db: database.db,
  pingDb: database.ping,
  antiCheat,
  logger: true,
});
app.log.info(
  `Античит: ${antiCheat.provider === 'noop' ? 'заглушка (публичная сборка)' : antiCheat.provider}`,
);

app.addHook('onClose', async () => {
  await database.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
