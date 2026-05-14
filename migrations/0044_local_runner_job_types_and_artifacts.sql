-- Extend local runner jobs with typed payload/result support.
-- This migration is additive and preserves legacy shell-command fields.

ALTER TABLE local_runner_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'shell_command';
ALTER TABLE local_runner_jobs ADD COLUMN payload_json TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN result_json TEXT DEFAULT NULL;
ALTER TABLE local_runner_jobs ADD COLUMN artifact_refs_json TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_job_type ON local_runner_jobs(job_type);

-- Store structured artifact metadata (screenshots and future binary refs).
CREATE TABLE IF NOT EXISTS local_runner_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  runner_token_id INTEGER NOT NULL,
  runner_instance_id INTEGER DEFAULT NULL,
  job_id INTEGER NOT NULL,
  artifact_type TEXT NOT NULL,
  mime_type TEXT DEFAULT NULL,
  byte_size INTEGER DEFAULT NULL,
  width INTEGER DEFAULT NULL,
  height INTEGER DEFAULT NULL,
  capture_source TEXT DEFAULT NULL,
  capture_index INTEGER DEFAULT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'inline_base64',
  blob_base64 TEXT DEFAULT NULL,
  external_url TEXT DEFAULT NULL,
  metadata_json TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT NULL,
  FOREIGN KEY (runner_token_id) REFERENCES local_runner_tokens(id),
  FOREIGN KEY (runner_instance_id) REFERENCES local_runner_instances(id),
  FOREIGN KEY (job_id) REFERENCES local_runner_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_local_runner_artifacts_job_id ON local_runner_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_artifacts_user_id ON local_runner_artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_artifacts_instance_id ON local_runner_artifacts(runner_instance_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_artifacts_created_at ON local_runner_artifacts(created_at);
