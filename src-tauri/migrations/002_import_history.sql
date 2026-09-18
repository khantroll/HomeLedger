ALTER TABLE import_batches ADD COLUMN original_transaction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN original_total_minor INTEGER NOT NULL DEFAULT 0;

UPDATE import_batches
SET original_transaction_count = (
  SELECT COUNT(*) FROM transactions WHERE transactions.import_batch_id = import_batches.id
), original_total_minor = COALESCE((
  SELECT SUM(amount_minor) FROM transactions WHERE transactions.import_batch_id = import_batches.id
), 0);
