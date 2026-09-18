CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  statement_end_date TEXT NOT NULL CHECK(length(statement_end_date) = 10),
  opening_balance_minor INTEGER NOT NULL,
  closing_balance_minor INTEGER NOT NULL,
  reconciled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, statement_end_date)
);

CREATE TABLE reconciliation_items (
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  amount_minor INTEGER NOT NULL,
  status_before TEXT NOT NULL CHECK(status_before IN ('pending','cleared','review','reconciled')),
  PRIMARY KEY(reconciliation_id, transaction_id)
);

CREATE INDEX idx_reconciliations_account_date
  ON reconciliations(account_id, statement_end_date DESC, reconciled_at DESC);
