-- User-scoped workflow policies for local runner queue routing.
-- Workflows define defaults for job type, routing target, capabilities, and retry controls.

CREATE TABLE IF NOT EXISTS user_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    job_type TEXT NOT NULL DEFAULT 'shell_command',
    target_runner_token_id INTEGER DEFAULT NULL,
    target_runner_instance_id INTEGER DEFAULT NULL,
    capability_requirements_json TEXT DEFAULT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    timeout_seconds INTEGER NOT NULL DEFAULT 300,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_runner_token_id) REFERENCES local_runner_tokens(id) ON DELETE SET NULL,
    FOREIGN KEY (target_runner_instance_id) REFERENCES local_runner_instances(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_workflows_user_created
    ON user_workflows(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_workflows_user_enabled
    ON user_workflows(user_id, enabled, updated_at DESC);