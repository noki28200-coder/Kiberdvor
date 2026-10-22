import type { GameProvider } from './provider';

/**
 * FPV Kamikaze Drone: асинхронный формат «на очки». Мультиплеер в игре не подтверждён,
 * поэтому каждый летает на своём ПК, команда = сумма очков. Стартовый рейтинг — 1500,
 * дальше его двигает Glicko-2 по итогам турниров.
 */
export function createFpvProvider(): GameProvider {
  return {
    game: 'fpv',
    resultMode: 'submissions',
    needsHost: false,
    async fetchAccountInfo() {
      return { rankInGame: null, hoursPlayed: null };
    },
    async initialRating() {
      return 1500;
    },
  };
}
