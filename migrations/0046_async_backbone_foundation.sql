-- Async backbone foundation for queue/workflow migration.
-- Additive schema only: canonical ingress ledger, idempotency keys,
-- execution attempts, dead letters, and archive pointers.

CREATE TABLE IF NOT EXISTS async_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  guild_id TEXT,
  event_type TEXT,
  event_category TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  actor_id TEXT,
  target_id TEXT,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'accepted',
  payload_json TEXT NOT NULL,
  payload_hash TEXT,
  queue_name TEXT,
  queued_at TEXT,
  workflow_name TEXT,
  workflow_run_id TEXT,
  terminal_state TEXT,
  terminal_at TEXT,
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'event_ingress',
  first_event_id TEXT,
  state TEXT NOT NULL DEFAULT 'accepted',
  replay_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (first_event_id) REFERENCES async_events(id)
);

CREATE TABLE IF NOT EXISTS async_job_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  async_event_id TEXT NOT NULL,
  queue_name TEXT,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  error_message TEXT,
  metadata_json TEXT,
  FOREIGN KEY (async_event_id) REFERENCES async_events(id)
);

CREATE TABLE IF NOT EXISTS async_dead_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  async_event_id TEXT,
  queue_name TEXT,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (async_event_id) REFERENCES async_events(id)
);

CREATE TABLE IF NOT EXISTS audit_archive_pointers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  async_event_id TEXT NOT NULL UNIQUE,
  r2_bucket TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verification_state TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (async_event_id) REFERENCES async_events(id)
);

CREATE INDEX IF NOT EXISTS idx_async_events_guild_received
  ON async_events(guild_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_async_events_status_received
  ON async_events(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_async_events_correlation
  ON async_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_async_events_event_type_received
  ON async_events(event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_scope_last_seen
  ON idempotency_keys(scope, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_async_job_attempts_event_attempt
  ON async_job_attempts(async_event_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_async_job_attempts_status_started
  ON async_job_attempts(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_async_dead_letters_created
  ON async_dead_letters(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_archive_verification
  ON audit_archive_pointers(verification_state, archived_at DESC);