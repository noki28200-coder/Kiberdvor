import type { z } from 'zod';

/** GET к нашему API с проверкой ответа zod-схемой из @kiberdvor/shared. */
export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Запрос ${path} завершился с кодом ${res.status}`);
  }
  return schema.parse(await res.json());
}
