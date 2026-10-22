import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadServerAntiCheat } from './anticheat';

const hasPrivate = existsSync(
  fileURLToPath(new URL('../../../packages/private/src/server.ts', import.meta.url)),
);

describe('loadServerAntiCheat', () => {
  it.skipIf(hasPrivate)('без приватной части возвращает заглушку', async () => {
    const antiCheat = await loadServerAntiCheat();
    expect(antiCheat.provider).toBe('noop');
    expect(
      await antiCheat.verifyReport(null, {
        matchId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      }),
    ).toEqual({
      status: 'unchecked',
    });
  });

  it.skipIf(!hasPrivate)('с приватной частью загружает её реализацию', async () => {
    const antiCheat = await loadServerAntiCheat();
    expect(antiCheat.provider).not.toBe('noop');
  });
});
