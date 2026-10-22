import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const storedSchema = z.object({
  serverUrl: z.url().default('http://localhost:5173'),
  /** Токен игрового сервера (GSLT) хоста — шифруется средствами ОС. */
  gsltEncrypted: z.string().nullable().default(null),
  /** ПК организатора / компьютерного клуба: предлагается как нейтральный хост. */
  neutralHost: z.boolean().default(false),
  cs2Dir: z.string().nullable().default(null),
});
type Stored = z.infer<typeof storedSchema>;

const file = () => join(app.getPath('userData'), 'settings.json');

function read(): Stored {
  try {
    if (existsSync(file())) return storedSchema.parse(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    // Повреждённый файл настроек — начинаем с значений по умолчанию.
  }
  return storedSchema.parse({});
}

let cache: Stored | null = null;

export const settings = {
  get(): Stored {
    cache ??= read();
    return cache;
  },
  update(patch: Partial<Stored>) {
    cache = { ...settings.get(), ...patch };
    writeFileSync(file(), JSON.stringify(cache, null, 2));
  },
  setGslt(token: string) {
    const value = token.trim();
    if (!value) return settings.update({ gsltEncrypted: null });
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Шифрование ОС недоступно: GSLT не сохранён');
    settings.update({ gsltEncrypted: safeStorage.encryptString(value).toString('base64') });
  },
  getGslt(): string | null {
    const { gsltEncrypted } = settings.get();
    return gsltEncrypted ? safeStorage.decryptString(Buffer.from(gsltEncrypted, 'base64')) : null;
  },
  /** Папка сервера CS2 по умолчанию: рядом с данными приложения. */
  cs2Dir(): string {
    return settings.get().cs2Dir ?? join(app.getPath('userData'), 'cs2-server');
  },
};
