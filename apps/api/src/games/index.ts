import type { Game } from '@kiberdvor/shared';
import type { Env } from '../env';
import { createCs2Provider } from './cs2';
import { createDota2Provider } from './dota2';
import { createFpvProvider } from './fpv';
import type { GameProvider } from './provider';
import { createSteamWebApi } from './steam-web-api';

export type GameProviders = Record<Game, GameProvider>;

export function createGameProviders(env: Pick<Env, 'STEAM_API_KEY' | 'FACEIT_API_KEY'>) {
  const steam = createSteamWebApi(env.STEAM_API_KEY);
  const providers: GameProviders = {
    dota2: createDota2Provider(steam),
    cs2: createCs2Provider(steam, env.FACEIT_API_KEY),
    fpv: createFpvProvider(),
  };
  return { providers, steam };
}
