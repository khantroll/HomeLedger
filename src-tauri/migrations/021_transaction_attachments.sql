-- Transaction attachments / receipt retention.
-- Attachment bytes live in the managed app-data attachments directory;
-- SQLite stores metadata and relationships only.

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE
    CHECK(length(storage_key) BETWEEN 1 AND 80 AND storage_key NOT GLOB '*[/\]*' AND storage_key NOT GLOB '*..*'),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 260),
  media_type TEXT NOT NULL CHECK(length(media_type) BETWEEN 1 AND 120),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 10485760),
  sha256_hex TEXT NOT NULL CHECK(length(sha256_hex) = 64),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('manual','import_retention')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transaction_attachments (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  attached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (transaction_id, attachment_id)
);

CREATE INDEX idx_transaction_attachments_attachment
  ON transaction_attachments(attachment_id);

CREATE TABLE import_batch_attachments (
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  PRIMARY KEY (import_batch_id, attachment_id)
);

CREATE INDEX idx_import_batch_attachments_attachment
  ON import_batch_attachments(attachment_id);
