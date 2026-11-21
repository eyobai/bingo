-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'ROLLOVER';

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "carry_in_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "carry_out_minor" BIGINT NOT NULL DEFAULT 0;
