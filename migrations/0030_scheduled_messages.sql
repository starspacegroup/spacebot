-- Scheduled messages table
-- Stores messages that should be sent at a future time
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT,
    target_user_id TEXT,
    action_type TEXT NOT NULL,
    message_payload TEXT NOT NULL,
    send_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT,
    source_automation_id INTEGER,
    error_message TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_send_at 
    ON scheduled_messages(send_at, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_guild 
    ON scheduled_messages(guild_id, status);
