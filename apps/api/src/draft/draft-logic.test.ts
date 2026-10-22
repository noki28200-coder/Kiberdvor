import { describe, expect, it } from 'vitest';
import { buildSnakeOrder, chooseAutoPick, sortPool } from './draft-logic';

describe('buildSnakeOrder', () => {
  it('начинает самая слабая команда и разворачивает порядок', () => {
    const order = buildSnakeOrder(
      [
        { id: 'strong', avgRating: 1800, need: 2 },
        { id: 'weak', avgRating: 1200, need: 2 },
        { id: 'mid', avgRating: 1500, need: 2 },
      ],
      10,
    );
    expect(order).toEqual(['weak', 'mid', 'strong', 'strong', 'mid', 'weak']);
  });

  it('пропускает заполненные команды', () => {
    const order = buildSnakeOrder(
      [
        { id: 'a', avgRating: 1000, need: 1 },
        { id: 'b', avgRating: 1100, need: 3 },
      ],
      10,
    );
    expect(order).toEqual(['a', 'b', 'b', 'b']);
  });

  it('ограничивает число пиков размером пула', () => {
    expect(buildSnakeOrder([{ id: 'a', avgRating: 1000, need: 4 }], 2)).toEqual(['a', 'a']);
  });
});

describe('авто-пик', () => {
  const pool = [
    { userId: 'u1', rating: 1900, roles: ['pos1'], reservePriority: false },
    { userId: 'u2', rating: 1400, roles: ['pos5'], reservePriority: false },
    { userId: 'u3', rating: 1300, roles: ['pos5'], reservePriority: true },
  ];

  it('резерв прошлого драфта идёт первым', () => {
    expect(sortPool(pool).map((p) => p.userId)).toEqual(['u3', 'u1', 'u2']);
  });

  it('берёт игрока с недостающей ролью', () => {
    expect(chooseAutoPick(pool, ['pos1'])?.userId).toBe('u1');
  });

  it('без подходящей роли берёт первого в пуле', () => {
    expect(chooseAutoPick(pool, ['pos3'])?.userId).toBe('u3');
  });
});
