import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { randomToken, sha256 } from '../crypto';
import { sessions, steamAccounts, users } from '../db/schema';
import { forbidden, unauthorized } from '../http/errors';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export type SessionUser = typeof users.$inferSelect & {
  steamId: string | null;
};

export async function createSession(ctx: AppContext, reply: FastifyReply, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(ctx.now().getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  await ctx.db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.env.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

export async function destroySession(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await ctx.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function userIdFromToken(ctx: AppContext, token: string | undefined) {
  if (!token) return null;
  const [row] = await ctx.db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, ctx.now())));
  return row?.userId ?? null;
}

export async function loadUser(ctx: AppContext, userId: string): Promise<SessionUser | null> {
  const [row] = await ctx.db
    .select({ user: users, steamId: steamAccounts.steamId })
    .from(users)
    .leftJoin(steamAccounts, eq(steamAccounts.userId, users.id))
    .where(eq(users.id, userId));
  return row ? { ...row.user, steamId: row.steamId } : null;
}

export async function currentUser(ctx: AppContext, request: FastifyRequest) {
  const userId = await userIdFromToken(ctx, request.cookies[SESSION_COOKIE]);
  return userId ? loadUser(ctx, userId) : null;
}

/** Вошёл через Яндекс ID и не забанен. */
export async function requireUser(ctx: AppContext, request: FastifyRequest) {
  const user = await currentUser(ctx, request);
  if (!user) throw unauthorized();
  if (user.bannedAt) throw forbidden('Аккаунт заблокирован');
  return user;
}

/** Дал согласие на обработку ПД (152-ФЗ) и привязал Steam — можно участвовать в турнирах. */
export async function requireParticipant(ctx: AppContext, request: FastifyRequest) {
  const user = await requireUser(ctx, request);
  if (!user.consentPdAt) throw forbidden('Сначала дайте согласие на обработку персональных данных');
  if (!user.steamId)
    throw forbidden('Привяжите Steam-аккаунт: без него нельзя заявиться на турнир');
  return user as SessionUser & { steamId: string };
}
