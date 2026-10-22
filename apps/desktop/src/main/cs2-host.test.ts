import { describe, expect, it } from 'vitest';
import { patchGameInfo } from './cs2-host';

const GAMEINFO = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_LowViolence	csgo_lv // Perfect World content override
			Game	csgo
			Game	csgo_imported
		}
	}
}`;

describe('patchGameInfo', () => {
  it('добавляет Metamod перед основной игрой', () => {
    const patched = patchGameInfo(GAMEINFO);
    const lines = patched.split('\n').map((l) => l.trim());
    const metamod = lines.indexOf('Game\tcsgo/addons/metamod');
    expect(metamod).toBeGreaterThan(0);
    expect(metamod).toBeLessThan(lines.indexOf('Game\tcsgo'));
  });

  it('не добавляет строку повторно', () => {
    const once = patchGameInfo(GAMEINFO);
    expect(patchGameInfo(once)).toBe(once);
  });
});
