-- Incoming webhooks: URLs that an outside service POSTs to, to fire automations.
-- (The older `webhooks` table is OUTGOING: endpoints an automation calls.)
-- The secret is stored only as a SHA-256 hash; the raw value is shown once.

CREATE TABLE IF NOT EXISTS inbound_webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    public_id TEXT NOT NULL,          -- 32 hex chars, in the URL
    name TEXT NOT NULL,
    description TEXT,
    secret_hash TEXT NOT NULL,        -- sha256 hex of the bearer secret
    secret_prefix TEXT,               -- first characters of the secret, for display
    enabled INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_received_at TEXT,
    receive_count INTEGER NOT NULL DEFAULT 0,
    last_status TEXT,                 -- 'accepted' or a refusal reason
    rate_window_start INTEGER NOT NULL DEFAULT 0,  -- epoch seconds, start of the counted minute
    rate_window_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_webhooks_public_id ON inbound_webhooks(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_webhooks_guild_name ON inbound_webhooks(guild_id, name);
CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_guild_id ON inbound_webhooks(guild_id);

-- Per-server cap. NULL means "the tier default" (see inboundWebhookLimit in server-plans.ts).
ALTER TABLE server_plans ADD COLUMN max_inbound_webhooks INTEGER;
