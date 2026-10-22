// Развёртывание выделенного сервера CS2 на ПК хоста. Всё ставится из официальных источников
// (SteamCMD от Valve, Metamod от AlliedModders, MatchZy с GitHub) на ПК игрока —
// у нас игровые серверы не работают никогда.
//
// ВНИМАНИЕ: сервер CS2 существует только под Windows и Linux. Код рассчитан на Windows
// (целевая платформа клиента) и требует проверки на реальном ПК перед пилотом.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import extract from 'extract-zip';
import { z } from 'zod';
import { GAME_PORT } from './network';

export type Log = (line: string) => void;

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const METAMOD_LATEST = 'https://mms.alliedmods.net/mmsdrop/2.0/mmsource-latest-windows';
const METAMOD_DROP = 'https://mms.alliedmods.net/mmsdrop/2.0/';
const MATCHZY_RELEASE = 'https://api.github.com/repos/shobhit-pathak/MatchZy/releases/latest';
const CS2_APP_ID = '730';

export function hostSupported(): boolean {
  return process.platform === 'win32';
}

async function download(url: string, target: string, log: Log) {
  log(`Скачиваю ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать ${url}: ${res.status}`);
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
}

function run(command: string, args: string[], log: Log): Promise<number> {
  return new Promise((resolve, reject) => {
    // Аргументы передаются массивом, без shell: подстановка команд невозможна.
    const child = spawn(command, args, { windowsHide: true });
    child.stdout.on('data', (chunk: Buffer) => log(chunk.toString().trim()));
    child.stderr.on('data', (chunk: Buffer) => log(chunk.toString().trim()));
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });
}

async function ensureSteamCmd(root: string, log: Log) {
  const dir = join(root, 'steamcmd');
  const exe = join(dir, 'steamcmd.exe');
  if (existsSync(exe)) return exe;
  await mkdir(dir, { recursive: true });
  const zip = join(dir, 'steamcmd.zip');
  await download(STEAMCMD_URL, zip, log);
  await extract(zip, { dir });
  return exe;
}

/** Установка или обновление сервера CS2 через SteamCMD (анонимный вход, app 730). */
async function installServer(root: string, log: Log) {
  const steamcmd = await ensureSteamCmd(root, log);
  const serverDir = join(root, 'cs2');
  log('Обновляю сервер CS2 через SteamCMD (первый раз — около 35 ГБ)…');
  const code = await run(
    steamcmd,
    [
      '+force_install_dir',
      serverDir,
      '+login',
      'anonymous',
      '+app_update',
      CS2_APP_ID,
      'validate',
      '+quit',
    ],
    log,
  );
  // SteamCMD возвращает 7 после успешного обновления на некоторых версиях.
  if (code !== 0 && code !== 7) throw new Error(`SteamCMD завершился с кодом ${code}`);
  return serverDir;
}

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.url() })),
});

/** Metamod:Source и MatchZy (сборка вместе с CounterStrikeSharp). */
async function installPlugins(serverDir: string, log: Log) {
  const csgo = join(serverDir, 'game', 'csgo');
  const marker = join(csgo, 'addons', '.kiberdvor-plugins');
  const tmp = join(serverDir, '..', 'downloads');
  await mkdir(tmp, { recursive: true });

  const metamodFile = (await (await fetch(METAMOD_LATEST)).text()).trim();
  const release = githubReleaseSchema.parse(await (await fetch(MATCHZY_RELEASE)).json());
  const version = `${metamodFile}|${release.tag_name}`;
  if (existsSync(marker) && (await readFile(marker, 'utf8')) === version) {
    log('Плагины уже установлены');
    return;
  }

  const metamodZip = join(tmp, 'metamod.zip');
  await download(`${METAMOD_DROP}${metamodFile}`, metamodZip, log);
  await extract(metamodZip, { dir: csgo });

  const asset = release.assets.find((a) => /with-cssharp.*windows.*\.zip$/i.test(a.name));
  if (!asset) throw new Error('В релизе MatchZy нет сборки with-cssharp для Windows');
  const matchzyZip = join(tmp, 'matchzy.zip');
  await download(asset.browser_download_url, matchzyZip, log);
  await extract(matchzyZip, { dir: csgo });

  await writeFile(marker, version);
  log(`Установлены ${metamodFile} и MatchZy ${release.tag_name}`);
}

/** Metamod подключается строкой в gameinfo.gi перед основной игрой. */
export function patchGameInfo(content: string): string {
  if (content.includes('csgo/addons/metamod')) return content;
  return content.replace(
    /(\n(\s*)Game_LowViolence\s+csgo_lv[^\n]*)/,
    '$1\n$2Game\tcsgo/addons/metamod',
  );
}

let serverProcess: ChildProcess | null = null;

export interface LaunchOptions {
  root: string;
  configUrl: string;
  serverPassword: string;
  gslt: string;
  log: Log;
}

/**
 * Запуск сервера. rcon закрыт (пустой пароль), конфиг матча MatchZy забирает с сайта
 * сам по ссылке с одноразовым токеном — составы по SteamID хост изменить не может.
 */
export async function launchServer({ root, configUrl, serverPassword, gslt, log }: LaunchOptions) {
  if (!hostSupported()) throw new Error('Сервер CS2 можно запустить только на Windows');
  if (serverProcess) throw new Error('Сервер уже запущен');
  const serverDir = await installServer(root, log);
  await installPlugins(serverDir, log);

  const csgo = join(serverDir, 'game', 'csgo');
  const gameinfo = join(csgo, 'gameinfo.gi');
  await writeFile(gameinfo, patchGameInfo(await readFile(gameinfo, 'utf8')));

  // Загрузка матча — после старта карты, когда плагины уже загружены.
  const cfgDir = join(csgo, 'cfg');
  await mkdir(cfgDir, { recursive: true });
  await writeFile(join(cfgDir, 'kiberdvor_match.cfg'), `matchzy_loadmatch_url "${configUrl}"\n`);

  const exe = join(serverDir, 'game', 'bin', 'win64', 'cs2.exe');
  const args = [
    '-dedicated',
    '-console',
    // Консоль сервера пишется в файл (с Metamod — game/csgo/addons/metamod/console.log).
    '-condebug',
    '-port',
    String(GAME_PORT),
    '+map',
    'de_dust2',
    '+sv_setsteamaccount',
    gslt,
    '+sv_password',
    serverPassword,
    '+rcon_password',
    '',
    '+exec',
    'kiberdvor_match.cfg',
  ];
  log('Запускаю сервер CS2…');
  // Вывод не в pipe: непрочитанный pipe переполняется, и сервер зависает на записи в консоль.
  serverProcess = spawn(exe, args, { cwd: serverDir, windowsHide: false, stdio: 'ignore' });
  serverProcess.once('exit', (code) => {
    log(`Сервер CS2 остановлен (код ${code ?? 0})`);
    serverProcess = null;
  });
  return { csgoDir: csgo };
}

export function stopServer() {
  serverProcess?.kill();
  serverProcess = null;
}

/** sha256 самого свежего демо: само демо остаётся у хоста, на сайт уходит только хеш. */
export async function latestDemoHash(csgoDir: string): Promise<string | null> {
  const demoDir = join(csgoDir, 'MatchZy');
  if (!existsSync(demoDir)) return null;
  const demos = await Promise.all(
    (await readdir(demoDir))
      .filter((f) => f.endsWith('.dem'))
      .map(async (f) => ({
        path: join(demoDir, f),
        mtime: (await stat(join(demoDir, f))).mtimeMs,
      })),
  );
  const latest = demos.sort((a, b) => b.mtime - a.mtime)[0];
  if (!latest) return null;
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(latest.path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}
