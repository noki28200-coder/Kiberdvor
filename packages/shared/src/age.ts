import { GAME_INFO, type Game } from './games';

/** Полных лет на дату `at`. Даты считаются по UTC. */
export function ageAt(birthDate: Date, at: Date): number {
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Допускает ли возрастная маркировка игры участника (436-ФЗ). Проверяется на бэкенде при заявке. */
export function isOldEnoughFor(game: Game, birthDate: Date, at: Date): boolean {
  return ageAt(birthDate, at) >= GAME_INFO[game].minAge;
}
