CREATE TABLE debt_plan_settings (
  currency TEXT PRIMARY KEY CHECK(length(currency) = 3),
  strategy TEXT NOT NULL DEFAULT 'avalanche' CHECK(strategy IN ('snowball','avalanche','custom')),
  extra_payment_minor INTEGER NOT NULL DEFAULT 0 CHECK(extra_payment_minor >= 0),
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE debt_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  annual_rate_bps INTEGER NOT NULL CHECK(annual_rate_bps BETWEEN 0 AND 100000),
  minimum_payment_minor INTEGER NOT NULL CHECK(minimum_payment_minor > 0),
  custom_priority INTEGER NOT NULL DEFAULT 0 CHECK(custom_priority >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_debt_terms_priority ON debt_terms(custom_priority, account_id);
