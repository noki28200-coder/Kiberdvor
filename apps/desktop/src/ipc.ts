// Типизированный контракт между preload и main. Renderer видит только window.kiberdvor.
// Всё, что приходит из renderer, main проверяет этими zod-схемами.
import type { Game, MatchStatus } from '@kiberdvor/shared';
import { z } from 'zod';

export interface AppInfo {
  version: string;
  platform: string;
  /** 'noop' — публичная сборка без приватного античита. */
  antiCheatProvider: string;
  hostSupported: boolean;
}

export interface AccountState {
  loggedIn: boolean;
  nickname: string | null;
  linkedSteamId: string | null;
  /** SteamID, под которым запущен Steam на этом ПК. */
  localSteamId: string | null;
  steamMatches: boolean | null;
}

export interface ActiveMatch {
  id: string;
  tournamentId: string;
  tournamentTitle: string;
  game: Game;
  label: string;
  status: MatchStatus;
  isHost: boolean;
}

export interface ClientSettings {
  serverUrl: string;
  neutralHost: boolean;
  hasGslt: boolean;
}

export const matchIdSchema = z.uuid();
export const settingsPatchSchema = z.object({
  serverUrl: z.url().optional(),
  neutralHost: z.boolean().optional(),
  gslt: z.string().max(64).optional(),
});
export const fpvSubmitSchema = z.object({
  matchId: z.uuid(),
  score: z.int().min(0).max(1_000_000),
  screenshotBase64: z.string().max(4_000_000),
  recordingSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const recordingSchema = z.object({
  matchId: z.uuid(),
  bytes: z.instanceof(Uint8Array),
});

export interface KiberdvorBridge {
  getAppInfo(): Promise<AppInfo>;
  getAccount(): Promise<AccountState>;
  login(): Promise<AccountState>;
  logout(): Promise<void>;
  getSettings(): Promise<ClientSettings>;
  updateSettings(patch: z.infer<typeof settingsPatchSchema>): Promise<ClientSettings>;
  listMatches(): Promise<ActiveMatch[]>;
  openInBrowser(path: string): Promise<void>;
  ready(matchId: string): Promise<void>;
  offerHost(matchId: string): Promise<{ reachable: boolean; upnp: string }>;
  measurePings(matchId: string): Promise<{ measured: number }>;
  launchServer(matchId: string): Promise<void>;
  captureScreen(): Promise<string>;
  saveRecording(input: z.infer<typeof recordingSchema>): Promise<string>;
  submitFpv(input: z.infer<typeof fpvSubmitSchema>): Promise<void>;
  onLog(listener: (line: string) => void): () => void;
  onMatchesChanged(listener: () => void): () => void;
}

export const IPC = {
  getAppInfo: 'app:get-info',
  getAccount: 'account:get',
  login: 'account:login',
  logout: 'account:logout',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  listMatches: 'matches:list',
  openInBrowser: 'app:open-in-browser',
  ready: 'match:ready',
  offerHost: 'match:offer-host',
  measurePings: 'match:measure-pings',
  launchServer: 'match:launch-server',
  captureScreen: 'fpv:capture-screen',
  saveRecording: 'fpv:save-recording',
  submitFpv: 'fpv:submit',
  log: 'event:log',
  matchesChanged: 'event:matches-changed',
} as const;
