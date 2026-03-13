-- Button action sets: reusable groups of buttons with associated action sequences
-- These can be attached to SEND_MESSAGE actions to add interactive buttons to bot messages
CREATE TABLE IF NOT EXISTS button_action_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    -- JSON array of button definitions:
    -- [{ "id": "unique_btn_id", "label": "Click Me", "style": 1, "emoji": "👋",
    --    "actions": [{ "type": "ADD_ROLE", "config": {...} }] }]
    -- style: 1=Primary(blurple), 2=Secondary(grey), 3=Success(green), 4=Danger(red), 5=Link
    buttons TEXT NOT NULL DEFAULT '[]',
    -- How many action rows this set uses (max 5 rows of 5 buttons = 25 buttons per message)
    row_count INTEGER DEFAULT 1,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_button_action_sets_guild ON button_action_sets(guild_id);

-- Track button click executions for analytics
CREATE TABLE IF NOT EXISTS button_click_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    button_set_id INTEGER,
    button_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT,
    channel_id TEXT,
    message_id TEXT,
    actions_executed TEXT, -- JSON array of action results
    success INTEGER DEFAULT 1,
    error_message TEXT,
    execution_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (button_set_id) REFERENCES button_action_sets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_button_click_logs_guild ON button_click_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_button_click_logs_button_set ON button_click_logs(button_set_id);
