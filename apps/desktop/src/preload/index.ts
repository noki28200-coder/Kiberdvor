import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppInfo, type KiberdvorBridge } from '../ipc';

const bridge: KiberdvorBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('kiberdvor', bridge);
