CREATE TABLE import_profiles_v22 (
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
  date_order TEXT NOT NULL DEFAULT 'mdy' CHECK(date_order IN ('mdy','dmy')),
  number_format TEXT NOT NULL DEFAULT 'dot' CHECK(number_format IN ('dot','comma')),
  source_kind TEXT NOT NULL DEFAULT 'delimited' CHECK(source_kind IN ('delimited','workbook','pdf','ocr')),
  source_signature TEXT CHECK(source_signature IS NULL OR length(source_signature) BETWEEN 1 AND 200),
  pdf_layout TEXT CHECK(pdf_layout IS NULL OR pdf_layout IN ('signed-last','signed-before-balance','debit-credit-last','debit-credit-before-balance','expenses-last','expenses-before-balance')),
  workbook_sheet_name TEXT CHECK(workbook_sheet_name IS NULL OR length(workbook_sheet_name) BETWEEN 1 AND 200),
  workbook_header_row INTEGER CHECK(workbook_header_row IS NULL OR workbook_header_row BETWEEN 0 AND 10000),
  UNIQUE(name, header_signature)
);

INSERT INTO import_profiles_v22(
  id,name,account_id,header_signature,date_column,payee_column,amount_column,debit_column,credit_column,
  created_at,modified_at,date_order,number_format,source_kind,source_signature,pdf_layout,workbook_sheet_name,workbook_header_row
)
SELECT
  id,name,account_id,header_signature,date_column,payee_column,amount_column,debit_column,credit_column,
  created_at,modified_at,date_order,number_format,source_kind,source_signature,pdf_layout,workbook_sheet_name,workbook_header_row
FROM import_profiles;

DROP TABLE import_profiles;
ALTER TABLE import_profiles_v22 RENAME TO import_profiles;
CREATE INDEX idx_import_profiles_signature ON import_profiles(header_signature, modified_at DESC);
CREATE INDEX idx_import_profiles_source ON import_profiles(source_kind, source_signature, modified_at DESC);
