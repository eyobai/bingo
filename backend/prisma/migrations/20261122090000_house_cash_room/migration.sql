ALTER TYPE "AccountType" ADD VALUE 'HOUSE_BANKROLL';
ALTER TYPE "AccountType" ADD VALUE 'HOUSE_CAPITAL';
ALTER TYPE "TxType" ADD VALUE 'HOUSE_FUNDING';

ALTER TABLE "rounds"
  ADD COLUMN "house_stake_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "house_prize_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "house_cards" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "house_winning_cards" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD CONSTRAINT "rounds_house_stake_within_pot" CHECK ("house_stake_minor" BETWEEN 0 AND "stake_total_minor"),
  ADD CONSTRAINT "rounds_house_prize_within_prize" CHECK ("house_prize_minor" BETWEEN 0 AND "prize_minor"),
  ADD CONSTRAINT "rounds_house_cards_funded" CHECK (
    ("house_stake_minor" = 0 AND cardinality("house_cards") = 0)
    OR ("room_id" = 'house-cash' AND "house_stake_minor" = 2 * "stake_minor" AND cardinality("house_cards") = 2)
  ),
  ADD CONSTRAINT "rounds_house_prize_matches_winning_cards" CHECK (
    "house_winning_cards" <@ "house_cards"
    AND "house_prize_minor" = "prize_per_winner_minor" * cardinality("house_winning_cards")
  );
