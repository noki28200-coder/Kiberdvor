import type { KiberdvorBridge } from '../ipc';

declare global {
  interface Window {
    kiberdvor: KiberdvorBridge;
  }
}
