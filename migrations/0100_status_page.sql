-- Public status page: component state, daily uptime counts, and incidents.

-- One row per component: the confirmed status plus the run of checks that disagree with it.
CREATE TABLE IF NOT EXISTS status_components (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'operational',      -- operational | degraded | down
    since TEXT NOT NULL DEFAULT (datetime('now')),   -- when the confirmed status began
    last_checked TEXT,
    latency_ms INTEGER,
    detail TEXT,                                     -- short plain-language reason, public
    pending_status TEXT,                             -- a different status seen on recent checks
    pending_count INTEGER NOT NULL DEFAULT 0,
    pending_since TEXT
);

-- Checks counted per component per UTC day, by the confirmed status at check time.
CREATE TABLE IF NOT EXISTS status_daily (
    component TEXT NOT NULL,
    day TEXT NOT NULL,                               -- YYYY-MM-DD, UTC
    checks INTEGER NOT NULL DEFAULT 0,
    operational INTEGER NOT NULL DEFAULT 0,
    degraded INTEGER NOT NULL DEFAULT 0,
    down INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (component, day)
);

CREATE TABLE IF NOT EXISTS status_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    impact TEXT NOT NULL DEFAULT 'minor',            -- minor | major | critical | maintenance
    status TEXT NOT NULL DEFAULT 'investigating',    -- investigating | identified | monitoring | resolved
    components TEXT NOT NULL DEFAULT '[]',           -- JSON array of component ids
    auto INTEGER NOT NULL DEFAULT 0,                 -- 1 when the checks opened it
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_incidents_open ON status_incidents(resolved_at);
CREATE INDEX IF NOT EXISTS idx_status_incidents_started ON status_incidents(started_at);

CREATE TABLE IF NOT EXISTS status_incident_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_incident_updates_incident
    ON status_incident_updates(incident_id, id);
