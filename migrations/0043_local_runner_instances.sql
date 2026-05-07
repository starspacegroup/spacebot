-- Track concrete machines/processes behind a local runner token.
-- A single user can run the same token on multiple systems, each with its own
-- instance identity, heartbeat, and event timeline.

CREATE TABLE IF NOT EXISTS local_runner_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runner_token_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  hostname TEXT DEFAULT NULL,
  platform TEXT DEFAULT NULL,
  platform_release TEXT DEFAULT NULL,
  arch TEXT DEFAULT NULL,
  runner_version TEXT DEFAULT NULL,
  default_workdir TEXT DEFAULT NULL,
  metadata TEXT DEFAULT NULL,
  last_seen_at TEXT DEFAULT NULL,
  last_seen_ip TEXT DEFAULT NULL,
  last_disconnect_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (runner_token_id) REFERENCES local_runner_tokens(id),
  UNIQUE (runner_token_id, instance_key)
);

CREATE INDEX IF NOT EXISTS idx_local_runner_instances_token_id ON local_runner_instances(runner_token_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_instances_user_id ON local_runner_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_instances_last_seen_at ON local_runner_instances(last_seen_at);

ALTER TABLE local_runner_jobs ADD COLUMN target_instance_id INTEGER DEFAULT NULL REFERENCES local_runner_instances(id);
ALTER TABLE local_runner_jobs ADD COLUMN claimed_by_instance_id INTEGER DEFAULT NULL REFERENCES local_runner_instances(id);

CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_target_instance_id ON local_runner_jobs(target_instance_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_claimed_by_instance_id ON local_runner_jobs(claimed_by_instance_id);

CREATE TABLE IF NOT EXISTS local_runner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  runner_token_id INTEGER NOT NULL,
  runner_instance_id INTEGER DEFAULT NULL,
  job_id INTEGER DEFAULT NULL,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  details TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (runner_token_id) REFERENCES local_runner_tokens(id),
  FOREIGN KEY (runner_instance_id) REFERENCES local_runner_instances(id),
  FOREIGN KEY (job_id) REFERENCES local_runner_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_local_runner_events_user_id ON local_runner_events(user_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_events_token_id ON local_runner_events(runner_token_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_events_instance_id ON local_runner_events(runner_instance_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_events_job_id ON local_runner_events(job_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_events_created_at ON local_runner_events(created_at);