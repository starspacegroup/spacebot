-- Add queue orchestration controls for local runner jobs.
-- This migration is fully additive and keeps legacy jobs compatible.

ALTER TABLE local_runner_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE local_runner_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE local_runner_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE local_runner_jobs ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 300;
ALTER TABLE local_runner_jobs ADD COLUMN started_at TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN next_retry_at TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN capability_requirements_json TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN canceled_at TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN cancel_reason TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN terminal_error TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_status_priority_created
  ON local_runner_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_status_retry
  ON local_runner_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_started_at
  ON local_runner_jobs(started_at);
