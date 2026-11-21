-- The test-player carry-over is removed.
ALTER TABLE "rounds" DROP COLUMN "carry_in_minor",
DROP COLUMN "carry_out_minor";
