-- CreateEnum
CREATE TYPE "RocketStatus" AS ENUM ('BETTING', 'FLYING', 'CRASHED');

-- CreateEnum
CREATE TYPE "RocketBetStatus" AS ENUM ('PLACED', 'CASHED', 'LOST', 'REFUNDED');

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'ROCKET_HOUSE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TxType" ADD VALUE 'ROCKET_BET';
ALTER TYPE "TxType" ADD VALUE 'ROCKET_PAYOUT';
ALTER TYPE "TxType" ADD VALUE 'ROCKET_REFUND';

-- CreateTable
CREATE TABLE "rocket_rounds" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "RocketStatus" NOT NULL DEFAULT 'BETTING',
    "server_seed" CHAR(64) NOT NULL,
    "seed_hash" CHAR(64) NOT NULL,
    "crash_x100" INTEGER NOT NULL,
    "house_edge_bps" INTEGER NOT NULL,
    "betting_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "crashed_at" TIMESTAMPTZ(3),
    "total_bet_minor" BIGINT NOT NULL DEFAULT 0,
    "total_paid_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rocket_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rocket_bets" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "paid_play_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_main_minor" BIGINT NOT NULL DEFAULT 0,
    "auto_x100" INTEGER,
    "cashed_x100" INTEGER,
    "payout_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "RocketBetStatus" NOT NULL DEFAULT 'PLACED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rocket_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rocket_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "house_edge_bps" INTEGER NOT NULL DEFAULT 300,
    "min_bet_minor" BIGINT NOT NULL DEFAULT 1000,
    "max_bet_minor" BIGINT NOT NULL DEFAULT 100000,
    "max_x100" INTEGER NOT NULL DEFAULT 10000,
    "max_win_minor" BIGINT NOT NULL DEFAULT 1000000,
    "betting_seconds" INTEGER NOT NULL DEFAULT 7,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rocket_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rocket_rounds_number_key" ON "rocket_rounds"("number");

-- CreateIndex
CREATE INDEX "rocket_rounds_status_idx" ON "rocket_rounds"("status");

-- CreateIndex
CREATE INDEX "rocket_bets_user_id_created_at_idx" ON "rocket_bets"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rocket_bets_round_id_user_id_slot_key" ON "rocket_bets"("round_id", "user_id", "slot");

-- AddForeignKey
ALTER TABLE "rocket_bets" ADD CONSTRAINT "rocket_bets_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rocket_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rocket_bets" ADD CONSTRAINT "rocket_bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Safety rules the database enforces whatever the code does.
ALTER TABLE "rocket_rounds"
  ADD CONSTRAINT "rocket_rounds_crash_valid" CHECK ("crash_x100" >= 100),
  ADD CONSTRAINT "rocket_rounds_edge_valid" CHECK ("house_edge_bps" BETWEEN 0 AND 2000),
  ADD CONSTRAINT "rocket_rounds_totals_valid" CHECK ("total_bet_minor" >= 0 AND "total_paid_minor" >= 0);
ALTER TABLE "rocket_bets"
  ADD CONSTRAINT "rocket_bets_slot_valid" CHECK ("slot" IN (1, 2)),
  ADD CONSTRAINT "rocket_bets_amounts_valid" CHECK ("stake_minor" > 0 AND "paid_play_minor" >= 0 AND "paid_main_minor" >= 0 AND "paid_play_minor" + "paid_main_minor" = "stake_minor" AND "payout_minor" >= 0),
  ADD CONSTRAINT "rocket_bets_auto_valid" CHECK ("auto_x100" IS NULL OR "auto_x100" >= 101),
  ADD CONSTRAINT "rocket_bets_cashed_valid" CHECK (("status" = 'CASHED') = ("cashed_x100" IS NOT NULL));
ALTER TABLE "rocket_settings"
  ADD CONSTRAINT "rocket_settings_one_row" CHECK ("id" = 1),
  ADD CONSTRAINT "rocket_settings_valid" CHECK ("house_edge_bps" BETWEEN 100 AND 2000 AND "min_bet_minor" > 0 AND "max_bet_minor" >= "min_bet_minor" AND "max_x100" BETWEEN 200 AND 100000 AND "max_win_minor" > 0 AND "betting_seconds" BETWEEN 4 AND 30);

-- Switched off until staff turn it on.
INSERT INTO "rocket_settings" ("id", "enabled", "updated_at") VALUES (1, false, now()) ON CONFLICT DO NOTHING;
