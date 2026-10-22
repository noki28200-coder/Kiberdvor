import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

/**
 * Комнаты: `tournament:<id>`, `match:<id>` — публичные, клиент подписывается сам;
 * `user:<id>` — личная, в неё сокет попадает по сессионной куке при подключении.
 */
export class Realtime {
  private io: Server | null = null;

  attach(
    server: HttpServer,
    resolveUserId: (cookieHeader: string | undefined) => Promise<string | null>,
  ) {
    const io = new Server(server, { path: '/socket.io', serveClient: false });
    io.on('connection', async (socket) => {
      const userId = await resolveUserId(socket.handshake.headers.cookie);
      if (userId) await socket.join(`user:${userId}`);
      socket.on('subscribe', (room: unknown) => {
        if (typeof room === 'string' && /^(tournament|match):[0-9a-f-]{36}$/.test(room)) {
          void socket.join(room);
        }
      });
      socket.on('unsubscribe', (room: unknown) => {
        if (typeof room === 'string') void socket.leave(room);
      });
    });
    this.io = io;
    return io;
  }

  tournamentChanged(tournamentId: string) {
    this.io?.to(`tournament:${tournamentId}`).emit('tournament:update', { tournamentId });
  }

  matchChanged(matchId: string, tournamentId: string) {
    this.io?.to(`match:${matchId}`).emit('match:update', { matchId });
    this.tournamentChanged(tournamentId);
  }

  toUsers(userIds: string[], event: string, payload: unknown) {
    if (!this.io || userIds.length === 0) return;
    this.io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
  }

  close() {
    return this.io?.close();
  }
}
