// Glicko-2 по статье М. Гликмана: http://www.glicko.net/glicko/glicko2.pdf

export interface GlickoRating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GlickoGame {
  opponent: Pick<GlickoRating, 'rating' | 'rd'>;
  /** 1 — победа, 0.5 — ничья, 0 — поражение. */
  score: number;
}

export const DEFAULT_RATING: GlickoRating = { rating: 1500, rd: 350, volatility: 0.06 };

const SCALE = 173.7178;
const TAU = 0.5;
const EPSILON = 0.000001;
const MIN_RD = 30;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Новый рейтинг игрока после рейтингового периода (у нас период = один матч). */
export function updateRating(player: GlickoRating, games: GlickoGame[]): GlickoRating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { ...player, rd: Math.min(phiStar * SCALE, DEFAULT_RATING.rd) };
  }

  const opponents = games.map((game) => ({
    mu: (game.opponent.rating - 1500) / SCALE,
    phi: game.opponent.rd / SCALE,
    score: game.score,
  }));

  const v =
    1 /
    opponents.reduce((sum, o) => {
      const e = expected(mu, o.mu, o.phi);
      return sum + g(o.phi) ** 2 * e * (1 - e);
    }, 0);

  const deltaSum = opponents.reduce(
    (sum, o) => sum + g(o.phi) * (o.score - expected(mu, o.mu, o.phi)),
    0,
  );
  const delta = v * deltaSum;

  // Новая волатильность — итерация Иллинойса (шаг 5 статьи).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (TAU * TAU)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: newMu * SCALE + 1500,
    rd: Math.max(newPhi * SCALE, MIN_RD),
    volatility: newSigma,
  };
}

/**
 * Командный матч: каждый игрок играет «против» усреднённого соперника —
 * средний рейтинг команды и среднеквадратичный RD.
 */
export function teamComposite(team: Pick<GlickoRating, 'rating' | 'rd'>[]): {
  rating: number;
  rd: number;
} {
  if (team.length === 0) return { rating: DEFAULT_RATING.rating, rd: DEFAULT_RATING.rd };
  const rating = team.reduce((s, p) => s + p.rating, 0) / team.length;
  const rd = Math.sqrt(team.reduce((s, p) => s + p.rd * p.rd, 0) / team.length);
  return { rating, rd };
}

export function updateTeamMatch(
  team1: GlickoRating[],
  team2: GlickoRating[],
  team1Score: number,
): { team1: GlickoRating[]; team2: GlickoRating[] } {
  const c1 = teamComposite(team1);
  const c2 = teamComposite(team2);
  return {
    team1: team1.map((p) => updateRating(p, [{ opponent: c2, score: team1Score }])),
    team2: team2.map((p) => updateRating(p, [{ opponent: c1, score: 1 - team1Score }])),
  };
}
