import { z } from 'zod';

export const TIERS = ['free', 'player_pro', 'organizer', 'club'] as const;
export const tierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof tierSchema>;

export interface TierInfo {
  title: string;
  priceRub: number;
  features: string[];
  /** Сколько своих турниров в месяц можно создать; null — без лимита. */
  tournamentsPerMonth: number | null;
  maxTeams: number;
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  free: {
    title: 'Базовый',
    priceRub: 0,
    features: ['Участие в турнирах', 'Анкета игрока', 'До 2 своих турниров в месяц до 16 команд'],
    tournamentsPerMonth: 2,
    maxTeams: 16,
  },
  player_pro: {
    title: 'Игрок Pro',
    priceRub: 199,
    features: [
      'Клипы и расширенная статистика в анкете',
      'История рейтинга',
      'Приоритет в листе ожидания',
      'Оформление профиля',
    ],
    tournamentsPerMonth: 2,
    maxTeams: 16,
  },
  organizer: {
    title: 'Организатор',
    priceRub: 990,
    features: [
      'Турниры без лимита до 128 команд',
      'Страница сообщества и логотип',
      'Сезонные лиги',
      'Экспорт результатов',
    ],
    tournamentsPerMonth: null,
    maxTeams: 128,
  },
  club: {
    title: 'Клуб или вуз',
    priceRub: 4990,
    features: ['Несколько организаторов', 'Брендирование', 'Статистика по участникам'],
    tournamentsPerMonth: null,
    maxTeams: 128,
  },
};

export const subscribeInputSchema = z.object({
  tier: tierSchema.exclude(['free']),
});
