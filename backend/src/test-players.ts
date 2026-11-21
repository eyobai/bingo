/** Telegram ids used by test players (TEST_MODE). Real players never get one of these. */
export const TEST_ID_MIN = 900_001;
export const TEST_ID_MAX = 999_999;
export const isTestPlayer = (telegramId: bigint | number) => Number(telegramId) >= TEST_ID_MIN && Number(telegramId) <= TEST_ID_MAX;
