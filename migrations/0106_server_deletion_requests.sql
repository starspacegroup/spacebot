-- A delete is two steps: type the name, then confirm after a short wait. This holds the step-one
-- token, bound to one person and one server. It is used once and expires in ten minutes.
CREATE TABLE IF NOT EXISTS server_deletion_requests (
    token TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_deletion_requests_guild ON server_deletion_requests(guild_id, user_id);
