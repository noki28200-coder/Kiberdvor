import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Renderer — обычное React-приложение. Доступа к Node.js у него нет, только window.kiberdvor из preload.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  // Явно IPv4: на Windows localhost у Node — это ::1, а Electron открывает 127.0.0.1.
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
