import * as Joi from 'joi';

/** Every setting the server reads, checked once at startup. A bad value stops the server with a clear message. */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_TTL: Joi.string().default('7d'),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  BOT_TOKEN: Joi.string().allow('').default(''),
  BOT_USERNAME: Joi.string().allow('').default(''),
  MINIAPP_URL: Joi.string().uri({ scheme: ['https', 'http'] }).allow('').default(''),
  INIT_DATA_MAX_AGE_SECONDS: Joi.number().integer().min(60).default(86_400),
  ADMIN_TELEGRAM_IDS: Joi.string().allow('').default(''),
  /** Lets the browser sign in without Telegram. Development only; refused in production. */
  DEV_LOGIN: Joi.boolean().default(false),
  /**
   * Test players on a live server, before launch. Only accounts 900001-999999 can be created, only with
   * TEST_KEY, and the game shows a TEST MODE banner. Turn off (and reset the database) before real players.
   */
  TEST_MODE: Joi.boolean().default(false),
  TEST_KEY: Joi.string().allow('').default(''),
  /** Players must share their phone number in the bot before buying cards. */
  REQUIRE_PHONE: Joi.boolean().default(true),

  CARD_SET_SEED: Joi.string().min(4).default('bingo-cards-v1'),
  RESULT_SECONDS: Joi.number().integer().min(2).max(60).default(8),
  SEED_ROOMS: Joi.boolean().default(true),

  DEPOSIT_MIN_BIRR: Joi.number().integer().min(1).default(100),
  WITHDRAW_MIN_BIRR: Joi.number().integer().min(1).default(100),
  FIRST_DEPOSIT_BONUS_PERCENT: Joi.number().integer().min(0).max(100).default(20),
  FIRST_DEPOSIT_BONUS_MAX_BIRR: Joi.number().integer().min(0).default(200),
  REFERRAL_BONUS_BIRR: Joi.number().integer().min(0).default(10),
  /** A player earns the invite reward for at most this many friends. 0 = no limit. */
  REFERRAL_MAX_FRIENDS: Joi.number().integer().min(0).default(30),
  WELCOME_BONUS_BIRR: Joi.number().integer().min(0).default(0),

  TELEBIRR_ACCOUNT: Joi.string().allow('').default(''),
  TELEBIRR_NAME: Joi.string().allow('').default(''),
  CBE_BIRR_ACCOUNT: Joi.string().allow('').default(''),
  CBE_BIRR_NAME: Joi.string().allow('').default(''),
}).custom((env: Record<string, unknown>, helpers) => {
  if (env.NODE_ENV === 'production' && env.DEV_LOGIN) return helpers.message({ custom: 'DEV_LOGIN must be false in production' });
  if (env.TEST_MODE && String(env.TEST_KEY).length < 16) {
    return helpers.message({ custom: 'TEST_MODE needs TEST_KEY of at least 16 characters (openssl rand -hex 16)' });
  }
  if (env.NODE_ENV === 'production' && !env.BOT_TOKEN) return helpers.message({ custom: 'BOT_TOKEN is required in production' });
  return env;
});

const birr = (n: number) => BigInt(n) * 100n;

export interface AppConfig {
  env: string;
  port: number;
  jwtSecret: string;
  jwtTtl: string;
  corsOrigins: string[];
  bot: { token: string; username: string; miniAppUrl: string; initDataMaxAge: number };
  /** Staff dashboard address: MINIAPP_URL + /admin/ (the server hosts both). */
  adminUrl: string;
  adminTelegramIds: Set<string>;
  devLogin: boolean;
  testMode: boolean;
  testKey: string;
  requirePhone: boolean;
  cardSetSeed: string;
  resultSeconds: number;
  seedRooms: boolean;
  money: {
    depositMinMinor: bigint;
    withdrawMinMinor: bigint;
    firstDepositBonusPercent: number;
    firstDepositBonusMaxMinor: bigint;
    referralBonusMinor: bigint;
    referralMaxFriends: number;
    welcomeBonusMinor: bigint;
  };
  paymentAccounts: { TELEBIRR: { account: string; name: string }; CBE_BIRR: { account: string; name: string } };
}

export function buildConfig(env: Record<string, any>): AppConfig {
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    jwtSecret: env.JWT_SECRET,
    jwtTtl: env.JWT_TTL,
    corsOrigins: String(env.CORS_ORIGINS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bot: {
      token: env.BOT_TOKEN,
      // People often paste it as "@name"; links need it without the @.
      username: String(env.BOT_USERNAME).trim().replace(/^@/, ''),
      miniAppUrl: env.MINIAPP_URL,
      initDataMaxAge: env.INIT_DATA_MAX_AGE_SECONDS,
    },
    adminUrl: env.MINIAPP_URL ? new URL('/admin/', env.MINIAPP_URL).toString() : '',
    adminTelegramIds: new Set(
      String(env.ADMIN_TELEGRAM_IDS)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    devLogin: env.DEV_LOGIN,
    testMode: env.TEST_MODE,
    testKey: env.TEST_KEY,
    requirePhone: env.REQUIRE_PHONE,
    cardSetSeed: env.CARD_SET_SEED,
    resultSeconds: env.RESULT_SECONDS,
    seedRooms: env.SEED_ROOMS,
    money: {
      depositMinMinor: birr(env.DEPOSIT_MIN_BIRR),
      withdrawMinMinor: birr(env.WITHDRAW_MIN_BIRR),
      firstDepositBonusPercent: env.FIRST_DEPOSIT_BONUS_PERCENT,
      firstDepositBonusMaxMinor: birr(env.FIRST_DEPOSIT_BONUS_MAX_BIRR),
      referralBonusMinor: birr(env.REFERRAL_BONUS_BIRR),
      referralMaxFriends: env.REFERRAL_MAX_FRIENDS,
      welcomeBonusMinor: birr(env.WELCOME_BONUS_BIRR),
    },
    paymentAccounts: {
      TELEBIRR: { account: env.TELEBIRR_ACCOUNT, name: env.TELEBIRR_NAME },
      CBE_BIRR: { account: env.CBE_BIRR_ACCOUNT, name: env.CBE_BIRR_NAME },
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
