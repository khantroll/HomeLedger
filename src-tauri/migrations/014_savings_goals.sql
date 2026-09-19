CREATE TABLE savings_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  target_minor INTEGER NOT NULL CHECK(target_minor > 0),
  target_date TEXT NOT NULL CHECK(length(target_date) = 10),
  planned_monthly_minor INTEGER NOT NULL DEFAULT 0 CHECK(planned_monthly_minor >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_savings_goals_target_date ON savings_goals(target_date, id);
