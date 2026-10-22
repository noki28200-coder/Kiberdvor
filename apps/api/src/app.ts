import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandler } from './http/errors';
import { healthRoute } from './routes/health';

export interface AppDeps {
  webOrigin: string;
  pingDb: () => Promise<boolean>;
  logger?: boolean;
}

export async function buildApp({ webOrigin, pingDb, logger = false }: AppDeps) {
  const app = Fastify({
    logger: logger && {
      // ПД в логи не пишем (152-ФЗ): заголовки с куками и токенами скрываем.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(cors, { origin: webOrigin, credentials: true });
  await app.register(healthRoute, { prefix: '/api', pingDb });

  return app;
}
