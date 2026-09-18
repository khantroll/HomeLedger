ALTER TABLE transactions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_transactions_account_external_id
ON transactions(account_id, external_id)
WHERE external_id IS NOT NULL;
