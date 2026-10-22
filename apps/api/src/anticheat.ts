import { noopServerAntiCheat, type ServerAntiCheat } from '@kiberdvor/shared';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Серверная проверка отчётов античита. Настоящая реализация — в приватном сабмодуле
 * packages/private (файл src/server.ts, экспорт `serverAntiCheat`). Без него — заглушка,
 * и публичная сборка работает как обычно. Вердикт античита только помечает матч
 * для организатора: результат, рейтинг и подписку решает сам API.
 */
const PRIVATE_SERVER_ENTRY = fileURLToPath(
  new URL('../../../packages/private/src/server.ts', import.meta.url),
);

function isServerAntiCheat(value: unknown): value is ServerAntiCheat {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ServerAntiCheat).provider === 'string' &&
    typeof (value as ServerAntiCheat).verifyReport === 'function'
  );
}

export async function loadServerAntiCheat(): Promise<ServerAntiCheat> {
  if (!existsSync(PRIVATE_SERVER_ENTRY)) return noopServerAntiCheat;
  const mod: unknown = await import(pathToFileURL(PRIVATE_SERVER_ENTRY).href);
  const impl = (mod as { serverAntiCheat?: unknown }).serverAntiCheat;
  if (!isServerAntiCheat(impl)) {
    throw new Error(
      'packages/private/src/server.ts должен экспортировать serverAntiCheat: ServerAntiCheat',
    );
  }
  return impl;
}
