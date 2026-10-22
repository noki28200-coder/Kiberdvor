import { clientAntiCheat } from '#anticheat';
import type { ClientAntiCheat } from '@kiberdvor/shared';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { IPC, type AppInfo } from '../ipc';

// Приватная реализация обязана соответствовать общему интерфейсу.
const antiCheat: ClientAntiCheat = clientAntiCheat;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Кибердвор',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Внешние ссылки — в системный браузер, а не внутрь клиента.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, 'renderer/index.html'));
}

ipcMain.handle(IPC.getAppInfo, (): AppInfo => ({
  version: app.getVersion(),
  platform: process.platform,
  antiCheatProvider: antiCheat.provider,
}));

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
