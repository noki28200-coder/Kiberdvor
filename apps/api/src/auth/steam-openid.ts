const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';

export function steamLoginUrl(returnTo: string, realm: string) {
  const url = new URL(STEAM_OPENID);
  url.searchParams.set('openid.ns', OPENID_NS);
  url.searchParams.set('openid.mode', 'checkid_setup');
  url.searchParams.set('openid.return_to', returnTo);
  url.searchParams.set('openid.realm', realm);
  url.searchParams.set('openid.identity', `${OPENID_NS}/identifier_select`);
  url.searchParams.set('openid.claimed_id', `${OPENID_NS}/identifier_select`);
  return url.toString();
}

/**
 * Проверка ответа Steam: параметры отправляются обратно в Steam с mode=check_authentication.
 * Возвращает SteamID64 или null, если подпись не подтвердилась.
 */
export async function verifySteamCallback(
  query: Record<string, string>,
  expectedReturnTo: string,
): Promise<string | null> {
  if (query['openid.mode'] !== 'id_res') return null;
  if (!query['openid.return_to']?.startsWith(expectedReturnTo)) return null;
  const claimed = query['openid.claimed_id'] ?? '';
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/.exec(claimed);
  if (!match) return null;

  const body = new URLSearchParams({ ...query, 'openid.mode': 'check_authentication' });
  const res = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? (match[1] ?? null) : null;
}
