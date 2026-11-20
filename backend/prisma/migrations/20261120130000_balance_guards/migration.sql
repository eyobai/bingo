-- Second line of defence behind the ledger code: the database itself refuses a negative balance on any
-- account not marked allow_negative, and refuses an unbalanced card price.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_balance_not_negative" CHECK ("allow_negative" OR "balance_minor" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_not_zero" CHECK ("amount_minor" <> 0);
ALTER TABLE "cards" ADD CONSTRAINT "cards_paid_not_negative" CHECK ("paid_play_minor" >= 0 AND "paid_main_minor" >= 0);
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_amount_positive" CHECK ("amount_minor" > 0);
