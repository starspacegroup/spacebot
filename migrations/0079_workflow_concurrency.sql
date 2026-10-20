-- Security review 2026-10-20 (#9): an advance of a superadmin workflow run
-- takes this lease first, so concurrent advance calls cannot execute the same
-- node's side effects twice.
ALTER TABLE superadmin_workflow_runs ADD COLUMN lease_until TEXT DEFAULT NULL;

-- One cron dispatch per template per scheduled minute, enforced by the
-- database rather than a SELECT-then-INSERT that overlapping ticks can race.
CREATE TABLE IF NOT EXISTS superadmin_workflow_cron_claims (
    template_id INTEGER NOT NULL,
    scheduled_minute TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (template_id, scheduled_minute)
);
