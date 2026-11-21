// Integration tests run against a separate database (TEST_DATABASE_URL), never the dev one.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/bingo_test?host=/tmp';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.DEV_LOGIN = 'true';
process.env.ADMIN_TELEGRAM_IDS = '1';
process.env.SEED_ROOMS = 'false';
process.env.RESULT_SECONDS = '2';
process.env.TELEBIRR_ACCOUNT = '0911000000';
process.env.TELEBIRR_NAME = 'ABEBE KEBEDE';
process.env.FIRST_DEPOSIT_BONUS_PERCENT = '20';
process.env.FIRST_DEPOSIT_BONUS_MAX_BIRR = '200';
process.env.REFERRAL_BONUS_BIRR = '10';
process.env.WELCOME_BONUS_BIRR = '20';
process.env.REFERRAL_MAX_FRIENDS = '1';
