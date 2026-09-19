ALTER TABLE scheduled_transactions
ADD COLUMN auto_post INTEGER NOT NULL DEFAULT 0 CHECK(auto_post IN (0,1));

CREATE INDEX idx_scheduled_auto_post
ON scheduled_transactions(auto_post, enabled, archived_at);
