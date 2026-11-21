-- A promo code is worth something, and can never be used more times than its limit.
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_uses_within_limit" CHECK ("max_uses" IS NULL OR "used_count" <= "max_uses");
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_amount_positive" CHECK ("amount_minor" > 0);
