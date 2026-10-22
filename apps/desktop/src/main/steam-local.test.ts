import { describe, expect, it } from 'vitest';
import { parseMostRecentSteamId } from './steam-local';

describe('parseMostRecentSteamId', () => {
  it('берёт аккаунт с MostRecent = 1', () => {
    const vdf = `"users"
{
  "76561198000000001"
  {
    "AccountName"   "old"
    "MostRecent"    "0"
  }
  "76561198000000002"
  {
    "AccountName"   "main"
    "MostRecent"    "1"
  }
}`;
    expect(parseMostRecentSteamId(vdf)).toBe('76561198000000002');
  });

  it('без отметки берёт первый аккаунт', () => {
    expect(parseMostRecentSteamId('"users" { "76561198000000009" { "AccountName" "x" } }')).toBe(
      '76561198000000009',
    );
  });

  it('пустой файл — нет аккаунта', () => {
    expect(parseMostRecentSteamId('')).toBeNull();
  });
});
