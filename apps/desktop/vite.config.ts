import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Renderer — обычное React-приложение. Доступа к Node.js у него нет, только window.kiberdvor из preload.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
