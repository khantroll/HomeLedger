-- Ordinary ↔ investment cash transfer durable linkage.
-- One ordinary ledger transaction is paired with one investment cash_transfer event.
CREATE TABLE ordinary_investment_cash_transfers (
  id TEXT PRIMARY KEY,
  ordinary_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  investment_event_id TEXT NOT NULL UNIQUE REFERENCES investment_events(id) ON DELETE RESTRICT,
  ordinary_account_id TEXT NOT NULL REFERENCES accounts(id),
  investment_account_id TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('ordinary_to_investment','investment_to_ordinary')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ordinary_account_id <> investment_account_id)
);
CREATE INDEX idx_oict_ordinary_account ON ordinary_investment_cash_transfers(ordinary_account_id);
CREATE INDEX idx_oict_investment_account ON ordinary_investment_cash_transfers(investment_account_id);
