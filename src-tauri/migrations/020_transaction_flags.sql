-- Follow-up flag for ordinary transactions (user metadata; no accounting effect).
-- User notes continue to use the existing transactions.memo column.
ALTER TABLE transactions ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0 CHECK(flagged IN (0, 1));
CREATE INDEX idx_transactions_flagged ON transactions(flagged) WHERE flagged = 1;
