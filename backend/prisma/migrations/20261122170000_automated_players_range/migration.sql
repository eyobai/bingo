-- Automated players per round become a range: a random number from min to max each round.
ALTER TABLE "rooms" ADD COLUMN "automated_min_players" INTEGER NOT NULL DEFAULT 0;
-- Rooms already set keep their fixed number (min = max).
UPDATE "rooms" SET "automated_min_players" = "automated_players";
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_automated_min_players_range"
  CHECK ("automated_min_players" BETWEEN 0 AND "automated_players");
