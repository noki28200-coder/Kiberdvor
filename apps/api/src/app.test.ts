import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  it('сообщает, что БД доступна', async () => {
    const app = await buildApp({ webOrigin: 'http://localhost:5173', pingDb: async () => true });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('сообщает, что БД недоступна, но сам отвечает', async () => {
    const app = await buildApp({ webOrigin: 'http://localhost:5173', pingDb: async () => false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', db: 'unavailable' });
  });
});
