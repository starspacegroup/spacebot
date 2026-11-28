-- A server that was deleted from the dashboard: who did it, when, and how many rows went.
-- This is all that is kept. No names and no content, so the delete stays complete.
CREATE TABLE IF NOT EXISTS server_deletions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    deleted_by TEXT,
    rows_removed INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_server_deletions_guild ON server_deletions(guild_id);
