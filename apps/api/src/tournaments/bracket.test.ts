import { describe, expect, it } from 'vitest';
import {
  bracketStandings,
  createBracket,
  isBracketFinished,
  listBracketMatches,
  reportBracketResult,
  type BracketState,
} from './bracket';
import { seedTeams } from './seeding';

/** Играет сетку до конца: всегда побеждает команда с меньшим номером посева. */
async function playOut(state: BracketState, seeds: string[]) {
  let current = state;
  for (let guard = 0; guard < 200 && !isBracketFinished(current); guard += 1) {
    const ready = listBracketMatches(current).find((m) => m.state === 'ready');
    if (!ready) throw new Error('Нет готовых матчей, но сетка не завершена');
    const t1 = seeds.indexOf(ready.team1Id!);
    const t2 = seeds.indexOf(ready.team2Id!);
    const winner = t1 < t2 ? ready.team1Id! : ready.team2Id!;
    current = await reportBracketResult(
      current,
      ready.key,
      winner,
      t1 < t2 ? 1 : 0,
      t1 < t2 ? 0 : 1,
    );
  }
  return current;
}

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('сетка', () => {
  for (const format of ['single_elimination', 'double_elimination', 'swiss'] as const) {
    for (const n of [2, 5, 8]) {
      it(`${format}, ${n} команд: доигрывается до победителя`, async () => {
        const seeds = teams(n);
        const finished = await playOut(await createBracket(format, seeds), seeds);
        expect(isBracketFinished(finished)).toBe(true);
        const { winnerTeamId } = bracketStandings(finished);
        expect(winnerTeamId).toBe('t1');
      });
    }
  }

  it('single elimination на 5 команд: первый посев проходит первый раунд без игры', async () => {
    const state = await createBracket('single_elimination', teams(5));
    const ready = listBracketMatches(state).filter((m) => m.state === 'ready');
    expect(ready.flatMap((m) => [m.team1Id, m.team2Id])).not.toContain('t1');
  });

  it('швейцарка не сводит команды повторно, пока есть выбор', async () => {
    const seeds = teams(8);
    const finished = await playOut(await createBracket('swiss', seeds), seeds);
    const pairs = listBracketMatches(finished).map((m) => [m.team1Id, m.team2Id].sort().join('-'));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('seedTeams', () => {
  it('сильнейшая команда получает первый посев', () => {
    expect(
      seedTeams([
        { id: 'a', avgRating: 1400 },
        { id: 'b', avgRating: 1700 },
        { id: 'c', avgRating: 1500 },
      ]),
    ).toEqual(['b', 'c', 'a']);
  });
});
