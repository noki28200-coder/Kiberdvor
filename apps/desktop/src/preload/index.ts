import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KiberdvorBridge } from '../ipc';

const subscribe = (channel: string, listener: (...args: never[]) => void) => {
  const handler = (_event: unknown, ...args: unknown[]) =>
    (listener as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

// Renderer получает только эти функции: ни Node.js, ни произвольного IPC.
const bridge: KiberdvorBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  getAccount: () => ipcRenderer.invoke(IPC.getAccount),
  login: () => ipcRenderer.invoke(IPC.login),
  logout: () => ipcRenderer.invoke(IPC.logout),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  listMatches: () => ipcRenderer.invoke(IPC.listMatches),
  openInBrowser: (path) => ipcRenderer.invoke(IPC.openInBrowser, path),
  ready: (matchId) => ipcRenderer.invoke(IPC.ready, matchId),
  offerHost: (matchId) => ipcRenderer.invoke(IPC.offerHost, matchId),
  measurePings: (matchId) => ipcRenderer.invoke(IPC.measurePings, matchId),
  launchServer: (matchId) => ipcRenderer.invoke(IPC.launchServer, matchId),
  captureScreen: () => ipcRenderer.invoke(IPC.captureScreen),
  saveRecording: (input) => ipcRenderer.invoke(IPC.saveRecording, input),
  submitFpv: (input) => ipcRenderer.invoke(IPC.submitFpv, input),
  onLog: (listener) => subscribe(IPC.log, listener),
  onMatchesChanged: (listener) => subscribe(IPC.matchesChanged, listener),
};

contextBridge.exposeInMainWorld('kiberdvor', bridge);
