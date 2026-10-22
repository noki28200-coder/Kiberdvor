import { z } from 'zod';

export const GAMES = ['dota2', 'cs2', 'fpv'] as const;
export const gameSchema = z.enum(GAMES);
export type Game = z.infer<typeof gameSchema>;

export const DOTA2_ROLES = ['pos1', 'pos2', 'pos3', 'pos4', 'pos5'] as const;
export const CS2_ROLES = ['entry', 'awp', 'support', 'lurker', 'igl'] as const;
export const FPV_ROLES = ['pilot', 'scout'] as const;

export const dota2RoleSchema = z.enum(DOTA2_ROLES);
export const cs2RoleSchema = z.enum(CS2_ROLES);
export const fpvRoleSchema = z.enum(FPV_ROLES);

export interface GameInfo {
  title: string;
  teamSize: number;
  /** Минимальный возраст участника (436-ФЗ). Решение Артема: на платформе все игры 16+. */
  minAge: number;
}

export const GAME_INFO: Record<Game, GameInfo> = {
  dota2: { title: 'Dota 2', teamSize: 5, minAge: 16 },
  cs2: { title: 'Counter-Strike 2', teamSize: 5, minAge: 16 },
  fpv: { title: 'FPV Kamikaze Drone', teamSize: 3, minAge: 16 },
};

export const GAME_ROLES: Record<Game, readonly string[]> = {
  dota2: DOTA2_ROLES,
  cs2: CS2_ROLES,
  fpv: FPV_ROLES,
};

export const ROLE_LABELS: Record<string, string> = {
  pos1: 'Керри (1)',
  pos2: 'Мидер (2)',
  pos3: 'Хардлейнер (3)',
  pos4: 'Роумер (4)',
  pos5: 'Саппорт (5)',
  entry: 'Entry',
  awp: 'AWP',
  support: 'Support',
  lurker: 'Lurker',
  igl: 'IGL',
  pilot: 'Пилот',
  scout: 'Разведчик',
};
