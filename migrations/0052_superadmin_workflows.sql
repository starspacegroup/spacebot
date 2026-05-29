-- Superadmin-managed workflow templates and run history.
-- This forms the CRUD foundation for migrating legacy cron tasks to Cloudflare Workflows.

CREATE TABLE IF NOT EXISTS superadmin_workflow_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT NULL,
    category TEXT NOT NULL DEFAULT 'operations',
    enabled INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    execution_backend TEXT NOT NULL DEFAULT 'cloudflare_workflows',
    legacy_job_name TEXT DEFAULT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'manual',
    cron_expression TEXT DEFAULT NULL,
    canvas_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    config_json TEXT DEFAULT NULL,
    published_version INTEGER NOT NULL DEFAULT 1,
    created_by_user_id TEXT NOT NULL,
    updated_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_templates_active
    ON superadmin_workflow_templates(archived, enabled, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_templates_category
    ON superadmin_workflow_templates(category, updated_at DESC);

CREATE TABLE IF NOT EXISTS superadmin_workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    requested_by_user_id TEXT DEFAULT NULL,
    workflow_instance_id TEXT DEFAULT NULL,
    legacy_history_id INTEGER DEFAULT NULL,
    input_json TEXT DEFAULT NULL,
    result_json TEXT DEFAULT NULL,
    error_message TEXT DEFAULT NULL,
    started_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    duration_ms INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES superadmin_workflow_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_runs_template_created
    ON superadmin_workflow_runs(template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_runs_status_created
    ON superadmin_workflow_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS superadmin_workflow_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    step_type TEXT NOT NULL,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    input_json TEXT DEFAULT NULL,
    output_json TEXT DEFAULT NULL,
    error_message TEXT DEFAULT NULL,
    started_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    duration_ms INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES superadmin_workflow_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_run_steps_run_position
    ON superadmin_workflow_run_steps(run_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_superadmin_workflow_run_steps_status
    ON superadmin_workflow_run_steps(status, updated_at DESC);