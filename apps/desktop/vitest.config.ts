import { defineConfig } from 'vitest/config';

// Тесты main-процесса; vite.config.ts описывает только renderer (root: src/renderer).
export default defineConfig({
  root: '.',
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
