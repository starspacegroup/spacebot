-- Workflow template version history + durable-execution run state.
-- Every definition change snapshots the full template into
-- superadmin_workflow_template_versions so any workflow can be reverted to any
-- past version. Runs gain state_json (advance-loop cursor/state for durable
-- Cloudflare Workflows execution) and pin the template_version they run.

CREATE TABLE IF NOT EXISTS superadmin_workflow_template_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT DEFAULT NULL,
    category TEXT NOT NULL DEFAULT 'operations',
    execution_backend TEXT NOT NULL DEFAULT 'cloudflare_workflows',
    legacy_job_name TEXT DEFAULT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'manual',
    cron_expression TEXT DEFAULT NULL,
    canvas_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    config_json TEXT DEFAULT NULL,
    change_note TEXT DEFAULT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, version),
    FOREIGN KEY (template_id) REFERENCES superadmin_workflow_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sa_wf_template_versions_lookup
    ON superadmin_workflow_template_versions(template_id, version DESC);

ALTER TABLE superadmin_workflow_templates ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0;

ALTER TABLE superadmin_workflow_runs ADD COLUMN state_json TEXT DEFAULT NULL;
ALTER TABLE superadmin_workflow_runs ADD COLUMN template_version INTEGER DEFAULT NULL;

-- Mark the shipped presets (matched by slug) as built-in.
UPDATE superadmin_workflow_templates SET is_builtin = 1 WHERE slug IN (
    'hourly-server-activity-rollup',
    'daily-server-intelligence-refresh',
    'minute-scheduled-message-dispatch',
    'workers-ai-catalog-sync',
    'rebuild-stats-recovery-run',
    'manual-member-role-cache-refresh',
    'local-runner-health-check'
);

-- Backfill: give every existing template a version row matching its live
-- definition so history starts non-empty.
INSERT INTO superadmin_workflow_template_versions (
    template_id, version, name, slug, description, category, execution_backend,
    legacy_job_name, schedule_type, cron_expression, canvas_json, config_json,
    change_note, created_by_user_id, created_at
)
SELECT id, published_version, name, slug, description, category, execution_backend,
    legacy_job_name, schedule_type, cron_expression, canvas_json, config_json,
    'Backfilled from live definition (migration 0055)', updated_by_user_id, updated_at
FROM superadmin_workflow_templates;
