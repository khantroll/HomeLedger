CREATE TABLE scheduled_transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('transaction','transfer')),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  transfer_account_id TEXT REFERENCES accounts(id),
  payee TEXT NOT NULL CHECK(length(payee) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL CHECK(amount_minor <> 0),
  status TEXT NOT NULL CHECK(status IN ('pending','cleared','review')),
  memo TEXT CHECK(memo IS NULL OR length(memo) <= 500),
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','biweekly','semimonthly','monthly','annual','custom')),
  anchor_date TEXT NOT NULL CHECK(length(anchor_date) = 10),
  end_date TEXT CHECK(end_date IS NULL OR (length(end_date) = 10 AND end_date >= anchor_date)),
  second_month_day INTEGER CHECK(second_month_day BETWEEN 1 AND 31),
  custom_interval_count INTEGER CHECK(custom_interval_count > 0),
  custom_interval_unit TEXT CHECK(custom_interval_unit IN ('days','weeks','months','years')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  CHECK(
    (kind = 'transaction' AND transfer_account_id IS NULL) OR
    (kind = 'transfer' AND transfer_account_id IS NOT NULL AND transfer_account_id <> account_id AND amount_minor > 0)
  ),
  CHECK(
    (frequency = 'semimonthly' AND second_month_day IS NOT NULL) OR
    (frequency <> 'semimonthly' AND second_month_day IS NULL)
  ),
  CHECK(
    (frequency = 'custom' AND custom_interval_count IS NOT NULL AND custom_interval_unit IS NOT NULL) OR
    (frequency <> 'custom' AND custom_interval_count IS NULL AND custom_interval_unit IS NULL)
  )
);

CREATE TABLE scheduled_occurrences (
  id TEXT PRIMARY KEY,
  scheduled_transaction_id TEXT NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL CHECK(length(due_date) = 10),
  status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','posted','skipped','linked')),
  transaction_id TEXT UNIQUE REFERENCES transactions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scheduled_transaction_id, due_date),
  CHECK(
    (status IN ('expected','skipped') AND transaction_id IS NULL) OR
    (status IN ('posted','linked') AND transaction_id IS NOT NULL)
  )
);

CREATE INDEX idx_scheduled_transactions_account ON scheduled_transactions(account_id, archived_at, enabled);
CREATE INDEX idx_scheduled_occurrences_due_status ON scheduled_occurrences(due_date, status);
CREATE INDEX idx_scheduled_occurrences_template_status ON scheduled_occurrences(scheduled_transaction_id, status, due_date);
