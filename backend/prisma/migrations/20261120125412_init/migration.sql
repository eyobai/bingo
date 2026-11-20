-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLAYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER_MAIN', 'USER_PLAY', 'USER_WITHDRAW_HOLD', 'GAME_POT', 'HOUSE_REVENUE', 'PROMOTIONS', 'PAYMENT_CLEARING', 'ADJUSTMENTS');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('DEPOSIT', 'BONUS', 'CARD_PURCHASE', 'CARD_REFUND', 'ROUND_SETTLEMENT', 'WITHDRAWAL_HOLD', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TELEBIRR', 'CBE_BIRR');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SELECTING', 'DRAWING', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "first_name" VARCHAR(128) NOT NULL,
    "last_name" VARCHAR(128),
    "language" VARCHAR(5) NOT NULL DEFAULT 'am',
    "phone" VARCHAR(20),
    "role" "Role" NOT NULL DEFAULT 'PLAYER',
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "referral_code" VARCHAR(16) NOT NULL,
    "referred_by_id" UUID,
    "referral_paid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "type" "AccountType" NOT NULL,
    "user_id" UUID,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "type" "TxType" NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "balance_after_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "tx_ref" VARCHAR(40) NOT NULL,
    "sms_text" VARCHAR(2000) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "bonus_minor" BIGINT NOT NULL DEFAULT 0,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "note" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "payout_ref" VARCHAR(60),
    "note" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "stake_minor" BIGINT NOT NULL,
    "card_pool" INTEGER NOT NULL,
    "max_cards_per_player" INTEGER NOT NULL DEFAULT 4,
    "select_seconds" INTEGER NOT NULL DEFAULT 60,
    "call_interval_ms" INTEGER NOT NULL DEFAULT 3000,
    "house_cut_bps" INTEGER NOT NULL DEFAULT 2000,
    "min_cards" INTEGER NOT NULL DEFAULT 2,
    "guaranteed_prize_minor" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "room_id" VARCHAR(32) NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'SELECTING',
    "stake_minor" BIGINT NOT NULL,
    "house_cut_bps" INTEGER NOT NULL,
    "guaranteed_minor" BIGINT NOT NULL DEFAULT 0,
    "server_seed" CHAR(64) NOT NULL,
    "seed_hash" CHAR(64) NOT NULL,
    "select_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "calls" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "cards_sold" INTEGER NOT NULL DEFAULT 0,
    "stake_total_minor" BIGINT NOT NULL DEFAULT 0,
    "prize_minor" BIGINT NOT NULL DEFAULT 0,
    "house_cut_minor" BIGINT NOT NULL DEFAULT 0,
    "top_up_minor" BIGINT NOT NULL DEFAULT 0,
    "prize_per_winner_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "card_no" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "paid_play_minor" BIGINT NOT NULL,
    "paid_main_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winners" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "card_no" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "line_index" INTEGER NOT NULL,
    "prize_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_user_id_type_key" ON "ledger_accounts"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_sequence_key" ON "ledger_entries"("sequence");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_sequence_idx" ON "ledger_entries"("account_id", "sequence");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_tx_ref_key" ON "deposits"("tx_ref");

-- CreateIndex
CREATE INDEX "deposits_status_created_at_idx" ON "deposits"("status", "created_at");

-- CreateIndex
CREATE INDEX "deposits_user_id_created_at_idx" ON "deposits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "withdrawals_status_created_at_idx" ON "withdrawals"("status", "created_at");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_created_at_idx" ON "withdrawals"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_number_key" ON "rounds"("number");

-- CreateIndex
CREATE INDEX "rounds_room_id_created_at_idx" ON "rounds"("room_id", "created_at");

-- CreateIndex
CREATE INDEX "rounds_status_idx" ON "rounds"("status");

-- CreateIndex
CREATE INDEX "cards_user_id_created_at_idx" ON "cards"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cards_round_id_card_no_key" ON "cards"("round_id", "card_no");

-- CreateIndex
CREATE INDEX "winners_user_id_created_at_idx" ON "winners"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "winners_round_id_card_no_key" ON "winners"("round_id", "card_no");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winners" ADD CONSTRAINT "winners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
