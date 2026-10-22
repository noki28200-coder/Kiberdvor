// Сборка main- и preload-процессов Electron через esbuild.
// `node build.mjs`       — production-сборка в dist/
// `node build.mjs --dev` — сборка + Vite dev-сервер для renderer + запуск Electron
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');

// Настоящий античит берём из приватного сабмодуля, если он скачан. Иначе — заглушка.
const privateClient = resolve(root, '../../packages/private/src/client.ts');
const antiCheatEntry = existsSync(privateClient)
  ? privateClient
  : resolve(root, 'src/main/anticheat-noop.ts');
console.log(
  existsSync(privateClient)
    ? 'Античит: приватная реализация (packages/private)'
    : 'Античит: заглушка (packages/private не найден — это нормально для публичной сборки)',
);

/** @type {import('esbuild').Plugin} */
const antiCheatPlugin = {
  name: 'anticheat',
  setup(b) {
    b.onResolve({ filter: /^#anticheat$/ }, () => ({ path: antiCheatEntry }));
  },
};

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // nat-upnp тянет xml2js 0.1, который падает в strict mode, а бандл esbuild целиком "use strict".
  // Поэтому он грузится из node_modules как есть (он в dependencies, electron-builder его упакует).
  external: ['electron', 'nat-upnp'],
  sourcemap: dev,
  minify: !dev,
  plugins: [antiCheatPlugin],
  // Приватный код может импортировать @kiberdvor/shared, даже если сам не объявил зависимости.
  nodePaths: [resolve(root, 'node_modules')],
  logLevel: 'warning',
};

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(root, 'src/main/index.ts')],
    outfile: resolve(root, 'dist/main.cjs'),
  }),
  build({
    ...common,
    entryPoints: [resolve(root, 'src/preload/index.ts')],
    outfile: resolve(root, 'dist/preload.cjs'),
  }),
]);

if (dev) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5174/';
  const electron = createRequire(import.meta.url)('electron');
  const child = spawn(electron, [root], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  child.on('exit', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
}
