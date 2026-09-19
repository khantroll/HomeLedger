CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(category) BETWEEN 1 AND 120),
  rollover_enabled INTEGER NOT NULL DEFAULT 0 CHECK(rollover_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE budget_allocations (
  id TEXT PRIMARY KEY,
  budget_category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
  planned_minor INTEGER NOT NULL CHECK(planned_minor>=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(budget_category_id,month)
);

CREATE INDEX idx_budget_allocations_month ON budget_allocations(month,budget_category_id);
