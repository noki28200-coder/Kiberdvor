import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Где лежит конфиг Steam-клиента на этой ОС. */
function steamConfigCandidates(): string[] {
  switch (process.platform) {
    case 'win32':
      return [
        join(
          process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
          'Steam',
          'config',
          'loginusers.vdf',
        ),
        join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam', 'config', 'loginusers.vdf'),
      ];
    case 'darwin':
      return [
        join(homedir(), 'Library', 'Application Support', 'Steam', 'config', 'loginusers.vdf'),
      ];
    default:
      return [
        join(homedir(), '.steam', 'steam', 'config', 'loginusers.vdf'),
        join(homedir(), '.local', 'share', 'Steam', 'config', 'loginusers.vdf'),
      ];
  }
}

/**
 * SteamID64 аккаунта, под которым последним входили в Steam-клиент на этом ПК.
 * loginusers.vdf: блоки "7656…" { … "MostRecent" "1" … }.
 */
export function parseMostRecentSteamId(vdf: string): string | null {
  const blocks = vdf.matchAll(/"(7656\d{13})"\s*\{([^}]*)\}/g);
  let fallback: string | null = null;
  for (const [, steamId, body] of blocks) {
    if (!steamId || body === undefined) continue;
    fallback ??= steamId;
    if (/"(MostRecent|mostrecent)"\s*"1"/.test(body)) return steamId;
  }
  return fallback;
}

export function localSteamId(): string | null {
  for (const path of steamConfigCandidates()) {
    if (existsSync(path)) return parseMostRecentSteamId(readFileSync(path, 'utf8'));
  }
  return null;
}
