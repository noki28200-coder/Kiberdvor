import { buildApp } from './app';
import { createDb } from './db/client';
import { loadEnv } from './env';

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
const app = await buildApp({ webOrigin: env.WEB_ORIGIN, pingDb: database.ping, logger: true });

app.addHook('onClose', async () => {
  await database.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
