CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO households(id, name) VALUES('local-household', 'Household');

CREATE TABLE household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  archived_at TEXT
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL DEFAULT 'local-household' REFERENCES households(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  institution TEXT CHECK(institution IS NULL OR length(institution) <= 80),
  account_type TEXT NOT NULL CHECK(account_type IN ('checking','savings','credit','cash','loan','asset')),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  owner_label TEXT NOT NULL CHECK(length(owner_label) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  source_name TEXT NOT NULL,
  source_sha256 TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at TEXT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  posted_date TEXT NOT NULL CHECK(length(posted_date) = 10),
  payee TEXT NOT NULL CHECK(length(payee) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','cleared','reconciled','review')),
  memo TEXT CHECK(memo IS NULL OR length(memo) <= 500),
  source TEXT NOT NULL CHECK(source IN ('manual','import','transfer','adjustment')),
  import_batch_id TEXT REFERENCES import_batches(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL,
  memo TEXT CHECK(memo IS NULL OR length(memo) <= 500)
);

CREATE TABLE transfer_links (
  id TEXT PRIMARY KEY,
  from_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  to_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  CHECK(from_transaction_id <> to_transaction_id)
);

CREATE INDEX idx_transactions_account_date ON transactions(account_id, posted_date DESC);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_import_batch ON transactions(import_batch_id);
