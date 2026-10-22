import { describe, expect, it } from 'vitest';
import { recommendHost, scoreCandidates } from './host-selection';

const players = ['a', 'b', 'c'];

describe('recommendHost', () => {
  it('выбирает кандидата с минимальным худшим пингом', () => {
    const candidates = [
      { userId: 'a', neutral: false, reachable: true },
      { userId: 'b', neutral: false, reachable: true },
    ];
    const pings = [
      { fromUserId: 'b', candidateUserId: 'a', rttMs: 80 },
      { fromUserId: 'c', candidateUserId: 'a', rttMs: 20 },
      { fromUserId: 'a', candidateUserId: 'b', rttMs: 40 },
      { fromUserId: 'c', candidateUserId: 'b', rttMs: 45 },
    ];
    expect(recommendHost(candidates, pings, players)).toBe('b');
  });

  it('нейтральный ПК в приоритете, даже если пинг хуже', () => {
    const candidates = [
      { userId: 'a', neutral: false, reachable: true },
      { userId: 'org', neutral: true, reachable: true },
    ];
    const pings = [
      { fromUserId: 'b', candidateUserId: 'a', rttMs: 10 },
      { fromUserId: 'a', candidateUserId: 'org', rttMs: 90 },
    ];
    expect(recommendHost(candidates, pings, players)).toBe('org');
  });

  it('не предлагает недоступный ПК (серый IP)', () => {
    const candidates = [{ userId: 'a', neutral: false, reachable: false }];
    expect(recommendHost(candidates, [], players)).toBeNull();
  });

  it('кандидат, до которого кто-то не достучался, не получает оценку', () => {
    const [score] = scoreCandidates(
      [{ userId: 'a', neutral: false, reachable: true }],
      [{ fromUserId: 'b', candidateUserId: 'a', rttMs: null }],
      players,
    );
    expect(score?.worstPingMs).toBeNull();
  });
});
