-- Store gateway console logs for superadmin debugging
CREATE TABLE IF NOT EXISTS gateway_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'gateway',
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_logs_logged_at
    ON gateway_logs(logged_at DESC);