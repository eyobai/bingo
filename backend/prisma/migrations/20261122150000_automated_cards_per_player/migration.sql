-- Automated players may take several cards each (1 up to automated_max_cards, chosen at random).
ALTER TABLE "rooms"
  ADD COLUMN "automated_max_cards" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "rooms_automated_max_cards_range" CHECK ("automated_max_cards" BETWEEN 1 AND 10);

ALTER TABLE "rounds" ADD COLUMN "house_owners" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
-- Earlier rounds had one card per automated player.
UPDATE "rounds" SET "house_owners" = ARRAY(SELECT generate_series(1, cardinality("house_cards")))
  WHERE cardinality("house_cards") > 0;

ALTER TABLE "rounds"
  DROP CONSTRAINT "rounds_house_cards_funded",
  -- Every automated card is paid at the round's normal stake and has an owner; skipped players never exceed those announced.
  ADD CONSTRAINT "rounds_house_cards_funded" CHECK (
    "house_stake_minor" = "stake_minor" * cardinality("house_cards")
    AND cardinality("house_owners") = cardinality("house_cards")
    AND "house_skipped" <= "house_planned"
  );
