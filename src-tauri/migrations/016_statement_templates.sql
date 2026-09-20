ALTER TABLE import_profiles ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'delimited' CHECK(source_kind IN ('delimited','workbook','pdf','ocr'));
ALTER TABLE import_profiles ADD COLUMN source_signature TEXT CHECK(source_signature IS NULL OR length(source_signature) BETWEEN 1 AND 200);
ALTER TABLE import_profiles ADD COLUMN pdf_layout TEXT CHECK(pdf_layout IS NULL OR pdf_layout IN ('signed-last','signed-before-balance','expenses-last','expenses-before-balance'));
ALTER TABLE import_profiles ADD COLUMN workbook_sheet_name TEXT CHECK(workbook_sheet_name IS NULL OR length(workbook_sheet_name) BETWEEN 1 AND 200);
ALTER TABLE import_profiles ADD COLUMN workbook_header_row INTEGER CHECK(workbook_header_row IS NULL OR workbook_header_row BETWEEN 0 AND 10000);

CREATE INDEX idx_import_profiles_source ON import_profiles(source_kind, source_signature, modified_at DESC);
