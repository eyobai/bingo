-- House-funded automated players in paid rooms (off by default, per room).
ALTER TYPE "TxType" ADD VALUE 'HOUSE_WITHDRAWAL';

ALTER TABLE "rooms"
  ADD COLUMN "automated_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automated_players" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "rooms_automated_players_range" CHECK ("automated_players" BETWEEN 0 AND 500);

ALTER TABLE "rounds"
  ADD COLUMN "house_planned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "house_skipped" INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT "rounds_house_cards_funded",
  -- Every automated card is paid at the round's normal stake, and never more cards than were announced.
  ADD CONSTRAINT "rounds_house_cards_funded" CHECK (
    "house_stake_minor" = "stake_minor" * cardinality("house_cards")
    AND (cardinality("house_cards") + "house_skipped" <= "house_planned" OR "room_id" = 'house-cash')
  );

-- The operator-capital offset account mirrors bankroll funding, so it goes negative.
UPDATE "ledger_accounts" SET "allow_negative" = true WHERE "code" = 'SYSTEM:HOUSE_CAPITAL';

CREATE TABLE "staff_audit" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" VARCHAR(64) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_audit_created_at_idx" ON "staff_audit"("created_at");
CREATE INDEX "staff_audit_target_type_target_id_created_at_idx" ON "staff_audit"("target_type", "target_id", "created_at");
ALTER TABLE "staff_audit" ADD CONSTRAINT "staff_audit_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
