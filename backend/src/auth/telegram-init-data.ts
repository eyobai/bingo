import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; startParam?: string; authDate: number }
  | { ok: false; reason: 'MISSING_HASH' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NO_USER' };

/**
 * Checks the `initData` string Telegram gives a Mini App, as documented at
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret = HMAC_SHA256(key = "WebAppData", data = botToken)
 * hash   = hex(HMAC_SHA256(key = secret, data = sorted "key=value" lines without `hash`))
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): InitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'MISSING_HASH' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSeconds - authDate > maxAgeSeconds) return { ok: false, reason: 'EXPIRED' };

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'NO_USER' };
  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    return { ok: false, reason: 'NO_USER' };
  }
  if (typeof user?.id !== 'number') return { ok: false, reason: 'NO_USER' };
  return { ok: true, user, startParam: params.get('start_param') ?? undefined, authDate };
}

/** Builds a signed initData string. Used by tests and the local dev login; never needed in production. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
