import { createServer, Socket, type Server } from 'node:net';
import { createClient } from 'nat-upnp';

export const GAME_PORT = 27015;

/** Время TCP-подключения до хоста — оценка пинга без прав администратора (ICMP недоступен). */
export function tcpRtt(ip: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const started = performance.now();
    const done = (rtt: number | null) => {
      socket.destroy();
      resolve(rtt);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(performance.now() - started));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
    socket.connect(port, ip);
  });
}

/** Лучший из нескольких замеров: первый часто дольше из-за ARP/NAT. */
export async function measurePing(ip: string, port: number, samples = 3): Promise<number | null> {
  const results: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const rtt = await tcpRtt(ip, port);
    if (rtt !== null) results.push(rtt);
  }
  return results.length ? Math.min(...results) : null;
}

/**
 * Пока ПК кандидат в хосты, на игровом порту слушает простой TCP-сервер:
 * по нему сайт проверяет доступность из интернета, а игроки меряют пинг.
 * Перед запуском CS2 он закрывается.
 */
let probe: Server | null = null;

export function openProbe(port = GAME_PORT): Promise<void> {
  if (probe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.end());
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      probe = server;
      resolve();
    });
  });
}

export function closeProbe(): Promise<void> {
  const server = probe;
  probe = null;
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

function mapPort(port: number, protocol: 'TCP' | 'UDP'): Promise<void> {
  const client = createClient();
  return new Promise((resolve, reject) => {
    client.portMapping(
      { public: port, private: port, protocol, description: 'Кибердвор CS2', ttl: 6 * 3600 },
      (error) => {
        client.close();
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

/**
 * Проброс игрового порта на роутере через UPnP (TCP — проверка и пинг, UDP — сама игра).
 * Не получилось — не беда: сайт всё равно проверит доступность и не предложит ПК с серым IP.
 */
export async function openRouterPort(port = GAME_PORT): Promise<{ ok: boolean; error?: string }> {
  try {
    await mapPort(port, 'TCP');
    await mapPort(port, 'UDP');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
