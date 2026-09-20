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

CREATE TRIGGER remember_transaction_category AFTER INSERT ON transactions
WHEN NEW.category <> 'Split transaction' AND NEW.category NOT LIKE 'Transfer:%'
BEGIN
  INSERT OR IGNORE INTO categories(id, name) VALUES('category-' || lower(hex(randomblob(16))), trim(NEW.category));
END;

CREATE TRIGGER remember_transaction_payee AFTER INSERT ON transactions
BEGIN
  INSERT OR IGNORE INTO payees(id, name) VALUES('payee-' || lower(hex(randomblob(16))), trim(NEW.payee));
END;

CREATE TRIGGER remember_updated_transaction AFTER UPDATE OF category, payee ON transactions
BEGIN
  INSERT OR IGNORE INTO payees(id, name) VALUES('payee-' || lower(hex(randomblob(16))), trim(NEW.payee));
  INSERT OR IGNORE INTO categories(id, name)
    SELECT 'category-' || lower(hex(randomblob(16))), trim(NEW.category)
    WHERE NEW.category <> 'Split transaction' AND NEW.category NOT LIKE 'Transfer:%';
END;

CREATE TRIGGER remember_split_category AFTER INSERT ON transaction_splits
BEGIN
  INSERT OR IGNORE INTO categories(id, name) VALUES('category-' || lower(hex(randomblob(16))), trim(NEW.category));
END;

CREATE TRIGGER remember_scheduled_labels AFTER INSERT ON scheduled_transactions
BEGIN
  INSERT OR IGNORE INTO payees(id, name) VALUES('payee-' || lower(hex(randomblob(16))), trim(NEW.payee));
  INSERT OR IGNORE INTO categories(id, name)
    SELECT 'category-' || lower(hex(randomblob(16))), trim(NEW.category) WHERE NEW.kind = 'transaction';
END;

CREATE TRIGGER remember_updated_scheduled_labels AFTER UPDATE OF payee, category ON scheduled_transactions
BEGIN
  INSERT OR IGNORE INTO payees(id, name) VALUES('payee-' || lower(hex(randomblob(16))), trim(NEW.payee));
  INSERT OR IGNORE INTO categories(id, name)
    SELECT 'category-' || lower(hex(randomblob(16))), trim(NEW.category) WHERE NEW.kind = 'transaction';
END;

CREATE TRIGGER remember_budget_category AFTER INSERT ON budget_categories
BEGIN
  INSERT OR IGNORE INTO categories(id, name) VALUES('category-' || lower(hex(randomblob(16))), trim(NEW.category));
END;

CREATE TRIGGER remember_updated_budget_category AFTER UPDATE OF category ON budget_categories
BEGIN
  INSERT OR IGNORE INTO categories(id, name) VALUES('category-' || lower(hex(randomblob(16))), trim(NEW.category));
END;

CREATE TRIGGER remember_rule_labels AFTER INSERT ON merchant_rules
BEGIN
  INSERT OR IGNORE INTO payees(id, name) SELECT 'payee-' || lower(hex(randomblob(16))), trim(NEW.rename_to) WHERE NEW.rename_to IS NOT NULL AND trim(NEW.rename_to) <> '';
  INSERT OR IGNORE INTO categories(id, name) SELECT 'category-' || lower(hex(randomblob(16))), trim(NEW.category) WHERE NEW.category IS NOT NULL AND trim(NEW.category) <> '';
END;

CREATE TRIGGER remember_updated_rule_labels AFTER UPDATE OF rename_to, category ON merchant_rules
BEGIN
  INSERT OR IGNORE INTO payees(id, name) SELECT 'payee-' || lower(hex(randomblob(16))), trim(NEW.rename_to) WHERE NEW.rename_to IS NOT NULL AND trim(NEW.rename_to) <> '';
  INSERT OR IGNORE INTO categories(id, name) SELECT 'category-' || lower(hex(randomblob(16))), trim(NEW.category) WHERE NEW.category IS NOT NULL AND trim(NEW.category) <> '';
END;
