CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE TABLE payees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE INDEX idx_categories_active_name ON categories(archived_at, name);
CREATE INDEX idx_payees_active_name ON payees(archived_at, name);

INSERT OR IGNORE INTO categories(id, name)
SELECT 'category-' || lower(hex(randomblob(16))), trim(category) FROM (
  SELECT category FROM transactions
  UNION SELECT category FROM transaction_splits
  UNION SELECT category FROM scheduled_transactions WHERE kind = 'transaction'
  UNION SELECT category FROM budget_categories
  UNION SELECT category FROM merchant_rules WHERE category IS NOT NULL
) WHERE trim(category) <> '' AND category <> 'Split transaction' AND category NOT LIKE 'Transfer:%';

INSERT OR IGNORE INTO payees(id, name)
SELECT 'payee-' || lower(hex(randomblob(16))), trim(payee) FROM (
  SELECT payee FROM transactions
  UNION SELECT payee FROM scheduled_transactions
  UNION SELECT rename_to AS payee FROM merchant_rules WHERE rename_to IS NOT NULL
) WHERE trim(payee) <> '';
