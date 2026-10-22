import { clientAntiCheat } from '#anticheat';
import type { ClientAntiCheat } from '@kiberdvor/shared';
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import { join } from 'node:path';
import {
  fpvSubmitSchema,
  IPC,
  matchIdSchema,
  recordingSchema,
  settingsPatchSchema,
  type AccountState,
  type AppInfo,
  type ClientSettings,
} from '../ipc';
import { apiRequest, currentUser, logout, openLoginWindow } from './api-client';
import { hostSupported, stopServer } from './cs2-host';
import { MatchService } from './matches';
import { closeProbe } from './network';
import { settings } from './settings';
import { localSteamId } from './steam-local';

// Приватная реализация обязана соответствовать общему интерфейсу.
const antiCheat: ClientAntiCheat = clientAntiCheat;
let mainWindow: BrowserWindow | null = null;

const log = (line: string) => {
  if (line) mainWindow?.webContents.send(IPC.log, line);
};
const matchService = new MatchService(antiCheat, log, () =>
  mainWindow?.webContents.send(IPC.matchesChanged),
);

async function accountState(): Promise<AccountState> {
  const me = await currentUser().catch(() => null);
  const local = localSteamId();
  const linked = me?.steam?.steamId ?? null;
  return {
    loggedIn: me !== null,
    nickname: me?.nickname ?? null,
    linkedSteamId: linked,
    localSteamId: local,
    steamMatches: linked && local ? linked === local : null,
  };
}

function clientSettings(): ClientSettings {
  const s = settings.get();
  return { serverUrl: s.serverUrl, neutralHost: s.neutralHost, hasGslt: s.gsltEncrypted !== null };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'Кибердвор',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://localhost'))
      void shell.openExternal(url);
    return { action: 'deny' };
  });
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, 'renderer/index.html'));
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle(IPC.getAppInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    antiCheatProvider: antiCheat.provider,
    hostSupported: hostSupported(),
  }));
  ipcMain.handle(IPC.getAccount, async () => {
    const state = await accountState();
    if (state.loggedIn) matchService.start();
    return state;
  });
  ipcMain.handle(IPC.login, async () => {
    if (mainWindow) await openLoginWindow(mainWindow);
    const state = await accountState();
    if (state.loggedIn) matchService.start();
    return state;
  });
  ipcMain.handle(IPC.logout, async () => {
    matchService.stop();
    await logout();
  });
  ipcMain.handle(IPC.getSettings, () => clientSettings());
  ipcMain.handle(IPC.updateSettings, (_event, raw: unknown) => {
    const patch = settingsPatchSchema.parse(raw);
    if (patch.gslt !== undefined) settings.setGslt(patch.gslt);
    settings.update({
      ...(patch.serverUrl ? { serverUrl: patch.serverUrl } : {}),
      ...(patch.neutralHost !== undefined ? { neutralHost: patch.neutralHost } : {}),
    });
    return clientSettings();
  });
  ipcMain.handle(IPC.listMatches, () => matchService.list());
  ipcMain.handle(IPC.openInBrowser, (_event, raw: unknown) => {
    const path = typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
    void shell.openExternal(`${settings.get().serverUrl}${path}`);
  });
  ipcMain.handle(IPC.ready, (_event, raw: unknown) => matchService.ready(matchIdSchema.parse(raw)));
  ipcMain.handle(IPC.offerHost, (_event, raw: unknown) =>
    matchService.offerHost(matchIdSchema.parse(raw)),
  );
  ipcMain.handle(IPC.measurePings, (_event, raw: unknown) =>
    matchService.measurePings(matchIdSchema.parse(raw)),
  );
  ipcMain.handle(IPC.launchServer, (_event, raw: unknown) =>
    matchService.launchServer(matchIdSchema.parse(raw)),
  );
  ipcMain.handle(IPC.captureScreen, () => matchService.captureScreen());
  ipcMain.handle(IPC.saveRecording, (_event, raw: unknown) => {
    const { matchId, bytes } = recordingSchema.parse(raw);
    return matchService.saveRecording(matchId, bytes);
  });
  ipcMain.handle(IPC.submitFpv, async (_event, raw: unknown) => {
    const { matchId, ...body } = fpvSubmitSchema.parse(raw);
    await apiRequest('POST', `/matches/${matchId}/fpv`, body);
  });
}

void app.whenReady().then(() => {
  // Запись залёта FPV: renderer просит экран, отдаём основной без системного диалога.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void desktopCapturer
      .getSources({ types: ['screen'] })
      .then(([source]) => callback(source ? { video: source } : {}));
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  matchService.stop();
  stopServer();
  void closeProbe();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
