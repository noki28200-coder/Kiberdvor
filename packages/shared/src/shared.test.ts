import { describe, expect, it } from 'vitest';
import { ageAt, createTournamentSchema, gameProfileInputSchema, isOldEnoughFor } from './index';

describe('ageAt', () => {
  const birth = new Date('2008-10-23T00:00:00Z');

  it('не засчитывает год до дня рождения', () => {
    expect(ageAt(birth, new Date('2026-10-22T00:00:00Z'))).toBe(17);
  });

  it('засчитывает год в день рождения', () => {
    expect(ageAt(birth, new Date('2026-10-23T00:00:00Z'))).toBe(18);
  });
});

describe('isOldEnoughFor', () => {
  it('пускает с 16 лет во все игры', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    expect(isOldEnoughFor('cs2', new Date('2010-10-23T00:00:00Z'), now)).toBe(false);
    expect(isOldEnoughFor('fpv', new Date('2010-10-22T00:00:00Z'), now)).toBe(true);
  });
});

describe('gameProfileInputSchema', () => {
  const base = {
    game: 'cs2',
    roles: ['awp'],
    availability: 'будни после 19:00',
    hasMic: true,
    languages: ['ru'],
    pitch: 'Стабильно держу B',
    clips: ['https://youtu.be/example'],
  };

  it('принимает корректную анкету', () => {
    expect(gameProfileInputSchema.safeParse(base).success).toBe(true);
  });

  it('отклоняет роль из другой игры', () => {
    expect(gameProfileInputSchema.safeParse({ ...base, roles: ['pos1'] }).success).toBe(false);
  });

  it('отклоняет «почему меня стоит пикнуть» длиннее 300 символов', () => {
    expect(gameProfileInputSchema.safeParse({ ...base, pitch: 'а'.repeat(301) }).success).toBe(
      false,
    );
  });

  it('принимает только https-ссылки на клипы', () => {
    expect(
      gameProfileInputSchema.safeParse({ ...base, clips: ['http://example.com'] }).success,
    ).toBe(false);
  });
});

describe('createTournamentSchema', () => {
  const base = {
    title: 'Кубок вуза',
    game: 'dota2',
    format: 'single_elimination',
    teamLimit: 8,
    registrationClosesAt: '2026-11-01T12:00:00+07:00',
    startsAt: '2026-11-02T12:00:00+07:00',
  };

  it('принимает корректный турнир', () => {
    expect(createTournamentSchema.safeParse(base).success).toBe(true);
  });

  it('отклоняет закрытие регистрации после старта', () => {
    const result = createTournamentSchema.safeParse({
      ...base,
      registrationClosesAt: '2026-11-03T12:00:00+07:00',
    });
    expect(result.success).toBe(false);
  });

  it('отклоняет больше 128 команд', () => {
    expect(createTournamentSchema.safeParse({ ...base, teamLimit: 129 }).success).toBe(false);
  });
});
