import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Bot, webhookCallback } from 'grammy';
import type { AppContext } from '../context';
import { users } from '../db/schema';

/**
 * Telegram-бот в том же процессе. Привязка: на сайте пользователь получает код,
 * отправляет боту `/start <код>`. В production бот работает на вебхуке
 * (/api/integrations/telegram/<секрет>), в разработке — long polling.
 */
export async function setupTelegram(ctx: AppContext, app: FastifyInstance) {
  const token = ctx.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const bot = new Bot(token);

  bot.command('start', async (message) => {
    const code = message.match.trim().toUpperCase();
    if (!code) {
      await message.reply(
        'Чтобы получать уведомления, возьмите код на сайте Кибердвора в профиле.',
      );
      return;
    }
    const [linked] = await ctx.db
      .update(users)
      .set({ telegramChatId: String(message.chat.id), telegramLinkCode: null })
      .where(eq(users.telegramLinkCode, code))
      .returning({ id: users.id });
    await message.reply(
      linked
        ? 'Готово: уведомления о матчах будут приходить сюда.'
        : 'Код не найден. Возьмите новый на сайте.',
    );
  });

  ctx.notifier.telegram = async (chatId, text) => {
    await bot.api.sendMessage(chatId, text);
  };

  const secret = ctx.env.TELEGRAM_WEBHOOK_SECRET;
  if (ctx.env.NODE_ENV === 'production' && secret) {
    const handle = webhookCallback(bot, 'fastify');
    app.post(`/api/integrations/telegram/${secret}`, (request, reply) => handle(request, reply));
    await bot.api.setWebhook(`${ctx.env.PUBLIC_URL}/api/integrations/telegram/${secret}`);
  } else {
    void bot.start({ drop_pending_updates: true });
  }
  return bot;
}
