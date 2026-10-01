ALTER TABLE merchant_rules
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
  CHECK(origin IN ('manual','remembered'));

CREATE INDEX IF NOT EXISTS idx_merchant_rules_precedence
  ON merchant_rules(enabled, origin, priority DESC, created_at, id);
