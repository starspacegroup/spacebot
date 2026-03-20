-- Gateway benchmark data
-- Stores periodic snapshots of Discord WebSocket gateway connection metrics
CREATE TABLE IF NOT EXISTS gateway_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    heartbeat_latency_ms INTEGER,
    gateway_url TEXT,
    shard_id INTEGER DEFAULT 0,
    guild_count INTEGER DEFAULT 0,
    uptime_seconds INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'connected',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_benchmarks_recorded_at
    ON gateway_benchmarks(recorded_at);
