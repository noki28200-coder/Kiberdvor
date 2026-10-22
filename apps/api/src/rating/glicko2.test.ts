import { describe, expect, it } from 'vitest';
import { DEFAULT_RATING, updateRating, updateTeamMatch } from './glicko2';

describe('updateRating', () => {
  it('совпадает с примером из статьи Гликмана', () => {
    const result = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ]);
    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });

  it('без игр увеличивает только RD', () => {
    const result = updateRating({ rating: 1600, rd: 100, volatility: 0.06 }, []);
    expect(result.rating).toBe(1600);
    expect(result.rd).toBeGreaterThan(100);
  });
});

describe('updateTeamMatch', () => {
  it('победители растут, проигравшие падают', () => {
    const team = [DEFAULT_RATING, DEFAULT_RATING];
    const { team1, team2 } = updateTeamMatch(team, team, 1);
    expect(team1[0]!.rating).toBeGreaterThan(1500);
    expect(team2[0]!.rating).toBeLessThan(1500);
  });
});
