import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Явно IPv4: на Windows localhost у Node — это ::1, а Electron и API ходят на 127.0.0.1.
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/socket.io': { target: 'http://127.0.0.1:3100', ws: true },
    },
  },
});
