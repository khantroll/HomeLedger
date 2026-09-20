CREATE TABLE ai_analysis_audit (
  id TEXT PRIMARY KEY NOT NULL,
  recorded_at TEXT NOT NULL,
  task_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  trust_classification TEXT NOT NULL,
  disclosure_mode TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  error_class TEXT
);
