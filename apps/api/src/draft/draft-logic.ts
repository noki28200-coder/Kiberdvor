export interface DraftTeam {
  id: string;
  avgRating: number;
  /** Сколько игроков не хватает до полного состава. */
  need: number;
}

/**
 * Очередь пиков змейкой: первым выбирает самая слабая по рейтингу команда,
 * в следующем круге порядок разворачивается. Заполненные команды выпадают из очереди.
 * Пиков не больше, чем свободных агентов в пуле.
 */
export function buildSnakeOrder(teams: DraftTeam[], poolSize: number): string[] {
  const sorted = [...teams]
    .filter((t) => t.need > 0)
    .sort((a, b) => a.avgRating - b.avgRating || a.id.localeCompare(b.id));
  const remaining = new Map(sorted.map((t) => [t.id, t.need]));
  const order: string[] = [];
  let round = 0;
  while (order.length < poolSize && [...remaining.values()].some((n) => n > 0)) {
    const lineup = round % 2 === 0 ? sorted : [...sorted].reverse();
    for (const team of lineup) {
      const need = remaining.get(team.id) ?? 0;
      if (need > 0 && order.length < poolSize) {
        order.push(team.id);
        remaining.set(team.id, need - 1);
      }
    }
    round += 1;
  }
  return order;
}

export interface PoolPlayer {
  userId: string;
  rating: number;
  roles: string[];
  reservePriority: boolean;
}

/** Порядок пула в интерфейсе: сначала резерв прошлого драфта, затем по рейтингу. */
export function sortPool<T extends PoolPlayer>(pool: T[]): T[] {
  return [...pool].sort(
    (a, b) =>
      Number(b.reservePriority) - Number(a.reservePriority) ||
      b.rating - a.rating ||
      a.userId.localeCompare(b.userId),
  );
}

/**
 * Авто-пик по истечении 60 секунд (решение зафиксировано: авто-пик, а не пропуск,
 * чтобы драфт не зависал). Берём лучшего по `sortPool` игрока с нужной команде ролью,
 * если такого нет — просто лучшего.
 */
export function chooseAutoPick<T extends PoolPlayer>(
  pool: T[],
  missingRoles: string[],
): T | undefined {
  const sorted = sortPool(pool);
  return sorted.find((p) => p.roles.some((r) => missingRoles.includes(r))) ?? sorted[0];
}
