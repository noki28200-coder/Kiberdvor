import { healthResponseSchema } from '@kiberdvor/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export interface HealthRouteOptions {
  pingDb: () => Promise<boolean>;
}

export const healthRoute: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, { pingDb }) => {
  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    db: (await pingDb()) ? ('ok' as const) : ('unavailable' as const),
  }));
};
