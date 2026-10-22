export interface HostCandidate {
  userId: string;
  neutral: boolean;
  reachable: boolean;
}

export interface PingSample {
  fromUserId: string;
  candidateUserId: string;
  rttMs: number | null;
}

export interface CandidateScore {
  userId: string;
  worstPingMs: number | null;
  pingCount: number;
}

/** Худший пинг до каждого кандидата; хост сам до себя пингует как 0. */
export function scoreCandidates(
  candidates: HostCandidate[],
  pings: PingSample[],
  playerIds: string[],
): CandidateScore[] {
  return candidates.map((c) => {
    const samples = playerIds.map((playerId) => {
      if (playerId === c.userId) return 0;
      const ping = pings.find((p) => p.fromUserId === playerId && p.candidateUserId === c.userId);
      return ping ? ping.rttMs : undefined;
    });
    const measured = samples.filter((s): s is number | null => s !== undefined);
    const unreachableForSomeone = measured.some((s) => s === null);
    const values = measured.filter((s): s is number => s !== null);
    return {
      userId: c.userId,
      worstPingMs: unreachableForSomeone || values.length === 0 ? null : Math.max(...values),
      pingCount: measured.length,
    };
  });
}

/**
 * Рекомендация хоста: нейтральный доступный ПК по умолчанию, иначе доступный ПК игрока
 * с минимальным худшим пингом (minimax). Недоступные (серый IP) не предлагаем.
 */
export function recommendHost(
  candidates: HostCandidate[],
  pings: PingSample[],
  playerIds: string[],
): string | null {
  const reachable = candidates.filter((c) => c.reachable);
  const scores = scoreCandidates(reachable, pings, playerIds);
  const byWorst = (ids: string[]) =>
    scores
      .filter((s) => ids.includes(s.userId) && s.worstPingMs !== null)
      .sort((a, b) => (a.worstPingMs ?? 0) - (b.worstPingMs ?? 0))[0]?.userId ?? null;

  const neutral = reachable.filter((c) => c.neutral).map((c) => c.userId);
  if (neutral.length > 0) return byWorst(neutral) ?? neutral[0] ?? null;
  return byWorst(reachable.map((c) => c.userId));
}
