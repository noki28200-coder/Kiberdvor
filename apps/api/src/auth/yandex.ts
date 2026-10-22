import { z } from 'zod';

const tokenSchema = z.object({ access_token: z.string() });
const infoSchema = z.object({
  id: z.string(),
  login: z.string(),
  default_email: z.string().optional(),
  birthday: z.string().nullable().optional(),
});

export interface YandexUser {
  yandexId: string;
  login: string;
  email: string | null;
  birthDate: string | null;
}

/** Ссылка на авторизацию. Scope минимальные (152-ФЗ): логин, email, дата рождения. */
export function yandexAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL('https://oauth.yandex.ru/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'login:info login:email login:birthday');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeYandexCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<YandexUser> {
  const tokenRes = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`Яндекс ID: не удалось получить токен (${tokenRes.status})`);
  const { access_token } = tokenSchema.parse(await tokenRes.json());

  const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!infoRes.ok) throw new Error(`Яндекс ID: не удалось получить профиль (${infoRes.status})`);
  const info = infoSchema.parse(await infoRes.json());

  // Яндекс отдаёт год 0000, если пользователь скрыл его; такую дату считаем неизвестной.
  const birthDate =
    info.birthday && /^\d{4}-\d{2}-\d{2}$/.test(info.birthday) && !info.birthday.startsWith('0000')
      ? info.birthday
      : null;

  return { yandexId: info.id, login: info.login, email: info.default_email ?? null, birthDate };
}
