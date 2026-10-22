import type { ClientAntiCheat, HostTask } from '@kiberdvor/shared';
import { app, desktopCapturer, Notification, screen } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveMatch } from '../ipc';
import { apiRequest, currentUser } from './api-client';
import { hostSupported, latestDemoHash, launchServer, type Log } from './cs2-host';
import { closeProbe, GAME_PORT, measurePing, openProbe, openRouterPort } from './network';
import { settings } from './settings';

/**
 * Следит за матчами пользователя: уведомляет о новых, запускает античит на время матча
 * и отправляет его отчёт, когда матч закончился.
 */
export class MatchService {
  private known = new Map<string, ActiveMatch>();
  private timer: NodeJS.Timeout | null = null;
  private hostTasks = new Map<string, { task: HostTask; csgoDir: string }>();

  constructor(
    private readonly antiCheat: ClientAntiCheat,
    private readonly log: Log,
    private readonly onChanged: () => void,
  ) {}

  start() {
    this.stop();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 10_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): ActiveMatch[] {
    return [...this.known.values()];
  }

  private async poll() {
    let matches: ActiveMatch[];
    try {
      matches = await apiRequest<ActiveMatch[]>('GET', '/me/matches');
    } catch {
      return;
    }
    const ids = new Set(matches.map((m) => m.id));
    for (const m of matches) {
      const before = this.known.get(m.id);
      if (!before && Notification.isSupported()) {
        new Notification({
          title: 'Кибердвор: матч готов',
          body: `${m.tournamentTitle}: ${m.label}`,
        }).show();
      }
      if (before && !before.isHost && m.isHost && Notification.isSupported()) {
        new Notification({
          title: 'Вы хост матча',
          body: 'Нажмите «Запустить сервер CS2» в клиенте',
        }).show();
      }
    }
    for (const id of this.known.keys()) {
      if (!ids.has(id)) await this.finished(id);
    }
    this.known = new Map(matches.map((m) => [m.id, m]));
    this.onChanged();
  }

  /** Матч пропал из активных — значит, завершён: отправляем отчёт античита и хеш демо. */
  private async finished(matchId: string) {
    try {
      const report = await this.antiCheat.collectReport(matchId);
      await apiRequest('POST', `/matches/${matchId}/anticheat-report`, { report });
      await this.antiCheat.stop();
    } catch (error) {
      this.log(`Отчёт античита не отправлен: ${String(error)}`);
    }
    const hosted = this.hostTasks.get(matchId);
    if (hosted) {
      const hash = await latestDemoHash(hosted.csgoDir).catch(() => null);
      if (hash) {
        await fetch(`${settings.get().serverUrl}/api/integrations/matchzy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Match-Token': hosted.task.remoteLogHeaderValue,
          },
          body: JSON.stringify({ event: 'kiberdvor_demo_hash', sha256: hash }),
        }).catch(() => undefined);
        this.log(`Хеш демо отправлен: ${hash.slice(0, 12)}…`);
      }
      this.hostTasks.delete(matchId);
    }
  }

  async ready(matchId: string) {
    const me = await currentUser();
    await apiRequest('POST', `/matches/${matchId}/ready`);
    if (me?.steam) {
      await this.antiCheat.start({ matchId, steamId: me.steam.steamId, gamePath: null });
    }
  }

  /** Предложить этот ПК хостом: открыть порт, пробросить его на роутере, сообщить сайту. */
  async offerHost(matchId: string) {
    await openProbe(GAME_PORT);
    const upnp = await openRouterPort(GAME_PORT);
    this.log(upnp.ok ? 'Порт 27015 проброшен через UPnP' : `UPnP не сработал: ${upnp.error ?? ''}`);
    const { reachable } = await apiRequest<{ reachable: boolean }>(
      'POST',
      `/matches/${matchId}/host-candidates`,
      {
        port: GAME_PORT,
        neutral: settings.get().neutralHost,
      },
    );
    this.log(
      reachable
        ? 'Сайт видит этот ПК из интернета: можно быть хостом'
        : 'ПК недоступен из интернета (серый IP?). Хостом его не предложат; запасной вариант — Radmin VPN / ZeroTier.',
    );
    return { reachable, upnp: upnp.ok ? 'ok' : (upnp.error ?? 'ошибка') };
  }

  /** Пинг до всех кандидатов матча — по нему сайт рекомендует хост (minimax). */
  async measurePings(matchId: string) {
    const candidates = await apiRequest<{ userId: string; ip: string; port: number }[]>(
      'GET',
      `/matches/${matchId}/host-candidates`,
    );
    const pings = [];
    for (const c of candidates) {
      const rttMs = await measurePing(c.ip, c.port);
      this.log(`Пинг до кандидата: ${rttMs === null ? 'нет связи' : `${Math.round(rttMs)} мс`}`);
      pings.push({ candidateUserId: c.userId, rttMs });
    }
    await apiRequest('POST', `/matches/${matchId}/pings`, { pings });
    return { measured: pings.length };
  }

  async launchServer(matchId: string) {
    if (!hostSupported()) throw new Error('Сервер CS2 можно запустить только на Windows');
    const gslt = settings.getGslt();
    if (!gslt) throw new Error('Укажите GSLT (токен игрового сервера) в настройках клиента');
    const task = await apiRequest<HostTask>('GET', `/matches/${matchId}/host-task`);
    const candidates = await apiRequest<{ userId: string; ip: string }[]>(
      'GET',
      `/matches/${matchId}/host-candidates`,
    );
    const me = await currentUser();
    const myIp = candidates.find((c) => c.userId === me?.id)?.ip;
    await closeProbe();
    const { csgoDir } = await launchServer({
      root: settings.cs2Dir(),
      configUrl: task.configUrl,
      serverPassword: task.serverPassword,
      gslt,
      log: this.log,
    });
    this.hostTasks.set(matchId, { task, csgoDir });
    await apiRequest('POST', `/matches/${matchId}/host-launched`, {
      connect: `${myIp ?? '127.0.0.1'}:${GAME_PORT}`,
    });
  }

  /** Скриншот основного экрана в PNG (base64) — итог залёта FPV. */
  async captureScreen(): Promise<string> {
    const { width, height } = screen.getPrimaryDisplay().size;
    const [source] = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });
    if (!source) throw new Error('Не удалось сделать скриншот экрана');
    return source.thumbnail.toPNG().toString('base64');
  }

  /** Запись залёта остаётся на ПК игрока; на сайт уходит только её sha256. */
  async saveRecording(matchId: string, bytes: Uint8Array): Promise<string> {
    const dir = join(app.getPath('videos'), 'Кибердвор');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `fpv-${matchId}.webm`), bytes);
    this.log(`Запись сохранена в ${dir}`);
    return createHash('sha256').update(bytes).digest('hex');
  }
}
