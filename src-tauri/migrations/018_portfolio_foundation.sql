-- Extending the account type in-place is deliberate. Rebuilding the parent accounts
-- table while foreign keys are active can invalidate populated child relationships.
-- sqlite_schema is changed narrowly, with FK enforcement left enabled; apply_migrations
-- validates the exact replacement and runs foreign_key_check before committing v18.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
SET sql = replace(sql,
  "account_type IN ('checking','savings','credit','cash','loan','asset')",
  "account_type IN ('checking','savings','credit','cash','loan','asset','investment')")
WHERE type='table' AND name='accounts';
PRAGMA writable_schema = RESET;

CREATE TABLE investment_account_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  account_kind TEXT NOT NULL CHECK(account_kind IN ('brokerage','retirement','education','other')),
  tax_treatment TEXT NOT NULL CHECK(tax_treatment IN ('taxable','tax_deferred','tax_exempt','unknown')),
  default_lot_method TEXT NOT NULL DEFAULT 'fifo' CHECK(default_lot_method='fifo'),
  opening_cash_minor INTEGER NOT NULL,
  opening_date TEXT NOT NULL CHECK(length(opening_date)=10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE securities (
  id TEXT PRIMARY KEY,
  security_type TEXT NOT NULL CHECK(security_type IN ('stock','etf','mutual_fund','bond','cash_equivalent','other')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  symbol TEXT CHECK(symbol IS NULL OR length(symbol)<=40),
  exchange_mic TEXT CHECK(exchange_mic IS NULL OR length(exchange_mic)<=20),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE security_identifiers (
  security_id TEXT NOT NULL REFERENCES securities(id),
  namespace TEXT NOT NULL CHECK(length(namespace) BETWEEN 1 AND 40),
  value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(security_id, namespace, value),
  UNIQUE(namespace, value)
);

CREATE TABLE investment_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  current_revision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE investment_event_revisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES investment_events(id),
  revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
  supersedes_revision_id TEXT REFERENCES investment_event_revisions(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('buy','sell','dividend','reinvest_dividend','interest','fee','split','return_of_capital','cash_transfer','security_transfer','opening_position','basis_adjustment')),
  trade_date TEXT NOT NULL CHECK(length(trade_date)=10),
  settlement_date TEXT CHECK(settlement_date IS NULL OR length(settlement_date)=10),
  acquisition_date TEXT CHECK(acquisition_date IS NULL OR length(acquisition_date)=10),
  security_id TEXT REFERENCES securities(id),
  related_account_id TEXT REFERENCES accounts(id),
  quantity_e8 INTEGER,
  unit_price_e8 INTEGER,
  gross_cash_minor INTEGER,
  cash_effect_minor INTEGER NOT NULL DEFAULT 0,
  income_minor INTEGER NOT NULL DEFAULT 0,
  acquisition_funding_minor INTEGER NOT NULL DEFAULT 0,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  basis_effect_minor INTEGER NOT NULL DEFAULT 0,
  split_numerator INTEGER,
  split_denominator INTEGER,
  status TEXT NOT NULL CHECK(status IN ('review','pending','cleared','reconciled')),
  source TEXT NOT NULL CHECK(source IN ('manual','import','broker')),
  memo TEXT CHECK(memo IS NULL OR length(memo)<=500),
  external_id TEXT CHECK(external_id IS NULL OR length(external_id)<=200),
  provenance TEXT CHECK(provenance IS NULL OR length(provenance)<=1000),
  group_id TEXT,
  correction_reason TEXT CHECK(correction_reason IS NULL OR length(correction_reason)<=500),
  corrected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, revision_number)
);
CREATE UNIQUE INDEX idx_investment_revision_superseded_once ON investment_event_revisions(supersedes_revision_id) WHERE supersedes_revision_id IS NOT NULL;
CREATE INDEX idx_investment_revisions_event ON investment_event_revisions(event_id, revision_number);
CREATE INDEX idx_investment_events_account ON investment_events(account_id);

CREATE TABLE investment_lot_allocations (
  sale_revision_id TEXT NOT NULL REFERENCES investment_event_revisions(id) ON DELETE CASCADE,
  acquisition_event_id TEXT NOT NULL REFERENCES investment_events(id),
  quantity_e8 INTEGER NOT NULL CHECK(quantity_e8 > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(sale_revision_id, acquisition_event_id)
);

CREATE TABLE security_prices (
  id TEXT PRIMARY KEY,
  security_id TEXT NOT NULL REFERENCES securities(id),
  observed_at TEXT NOT NULL,
  price_e8 INTEGER NOT NULL CHECK(price_e8 >= 0),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','market_provider')),
  provenance TEXT CHECK(provenance IS NULL OR length(provenance)<=1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(security_id, observed_at, source)
);
CREATE INDEX idx_security_prices_lookup ON security_prices(security_id, observed_at DESC);
