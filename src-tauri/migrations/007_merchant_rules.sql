ALTER TABLE transactions ADD COLUMN original_payee TEXT CHECK(original_payee IS NULL OR length(original_payee) BETWEEN 1 AND 160);

CREATE TABLE merchant_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  pattern TEXT NOT NULL CHECK(length(pattern) BETWEEN 1 AND 120),
  normalized_pattern TEXT NOT NULL CHECK(length(normalized_pattern) BETWEEN 1 AND 120),
  match_type TEXT NOT NULL CHECK(match_type IN ('contains','starts_with','exact')),
  direction TEXT NOT NULL CHECK(direction IN ('any','expense','income')),
  rename_to TEXT CHECK(rename_to IS NULL OR length(rename_to) BETWEEN 1 AND 160),
  category TEXT CHECK(category IS NULL OR length(category) BETWEEN 1 AND 120),
  priority INTEGER NOT NULL DEFAULT 100 CHECK(priority BETWEEN -10000 AND 10000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(rename_to IS NOT NULL OR category IS NOT NULL)
);

CREATE INDEX idx_merchant_rules_order ON merchant_rules(enabled, priority DESC, created_at, id);
