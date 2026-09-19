CREATE TABLE import_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  account_id TEXT REFERENCES accounts(id),
  header_signature TEXT NOT NULL CHECK(length(header_signature) BETWEEN 1 AND 2000),
  date_column INTEGER NOT NULL CHECK(date_column >= 0),
  payee_column INTEGER NOT NULL CHECK(payee_column >= 0),
  amount_column INTEGER NOT NULL,
  debit_column INTEGER NOT NULL,
  credit_column INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, header_signature)
);

CREATE INDEX idx_import_profiles_signature ON import_profiles(header_signature, modified_at DESC);
