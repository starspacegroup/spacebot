-- Per-automation, per-channel arm state for edge-triggered automations.
--
-- VOICE_CHANNEL_THRESHOLD fires once when a voice channel's head-count
-- crosses a threshold. To fire on the crossing and not on every join, each
-- automation remembers, per channel, whether it is armed and when it last
-- fired. Kept in D1 so a gateway restart does not re-arm everything.
-- `scope` names the kind of state so other edge triggers can reuse the table.

CREATE TABLE IF NOT EXISTS automation_trigger_state (
    automation_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    armed INTEGER NOT NULL DEFAULT 1,
    last_fired_at INTEGER,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (automation_id, scope)
);
