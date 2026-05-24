-- AI orchestration jobs and timeline events.
-- Additive migration for durable async AI execution, retries, and auditability.

CREATE TABLE IF NOT EXISTS ai_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed_terminal', 'canceled')),
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT NULL,
  guild_id TEXT DEFAULT NULL,
  request_text TEXT NOT NULL,
  history_json TEXT DEFAULT NULL,
  managed_guilds_json TEXT DEFAULT NULL,
  selected_guild_json TEXT DEFAULT NULL,
  response_target_json TEXT NOT NULL,
  provider_chain_json TEXT DEFAULT NULL,
  metadata_json TEXT DEFAULT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT DEFAULT (datetime('now')),
  started_at TEXT DEFAULT NULL,
  completed_at TEXT DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  last_retry_decision_json TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_next_retry
  ON ai_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created
  ON ai_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created
  ON ai_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  step TEXT DEFAULT NULL,
  message TEXT DEFAULT NULL,
  metadata_json TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES ai_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_job_events_job_created
  ON ai_job_events(job_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_job_events_type_created
  ON ai_job_events(event_type, created_at DESC);
