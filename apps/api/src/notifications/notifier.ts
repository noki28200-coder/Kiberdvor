import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import type { Realtime } from './realtime';

export interface Notification {
  text: string;
  /** Путь на сайте, например /matches/<id>. */
  link?: string;
  matchId?: string;
}

export type TelegramSend = (chatId: string, text: string) => Promise<void>;

/** Уведомления: в браузер и десктоп-клиент через WebSocket, плюс Telegram, если он привязан. */
export class Notifier {
  telegram: TelegramSend | null = null;

  constructor(
    private readonly db: Db,
    private readonly realtime: Realtime,
    private readonly publicUrl: string,
  ) {}

  async notify(userIds: string[], notification: Notification) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    this.realtime.toUsers(unique, 'notification', notification);

    const send = this.telegram;
    if (!send) return;
    const rows = await this.db
      .select({ chatId: users.telegramChatId })
      .from(users)
      .where(inArray(users.id, unique));
    const text = notification.link
      ? `${notification.text}\n${this.publicUrl}${notification.link}`
      : notification.text;
    await Promise.allSettled(rows.flatMap((r) => (r.chatId ? [send(r.chatId, text)] : [])));
  }
}
