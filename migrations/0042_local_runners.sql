-- Local Runner Tokens: user-scoped tokens for the local runner agent
-- Unlike guild API keys, these are tied to a user account and allow
-- a local Bun/Node process to poll for jobs and report results.

CREATE TABLE IF NOT EXISTS local_runner_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- First 8 chars of the token for identification (prefix: sbr_)
  token_prefix TEXT NOT NULL,
  -- SHA-256 hash of the full token (raw token is never stored)
  token_hash TEXT NOT NULL,
  -- Heartbeat tracking
  last_seen_at TEXT DEFAULT NULL,
  last_seen_ip TEXT DEFAULT NULL,
  -- Soft revoke
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_runner_tokens_user_id ON local_runner_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_tokens_token_prefix ON local_runner_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_local_runner_tokens_token_hash ON local_runner_tokens(token_hash);

-- Local Runner Jobs: tasks queued for a runner to execute
-- The runner polls for pending jobs, executes them locally (shell, scripts, etc.),
-- and reports the result back.

CREATE TABLE IF NOT EXISTS local_runner_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runner_token_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  -- The shell command / script path to run
  command TEXT NOT NULL,
  -- Working directory override (NULL = runner default)
  working_dir TEXT DEFAULT NULL,
  -- Execution status: pending | running | completed | failed | canceled
  status TEXT NOT NULL DEFAULT 'pending',
  -- Captured stdout+stderr (truncated to ~64KB)
  output TEXT DEFAULT NULL,
  -- Process exit code
  exit_code INTEGER DEFAULT NULL,
  -- Optional label shown in UI
  label TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (runner_token_id) REFERENCES local_runner_tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_runner_token_id ON local_runner_jobs(runner_token_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_user_id ON local_runner_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_local_runner_jobs_status ON local_runner_jobs(status);
