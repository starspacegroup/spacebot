-- Automations table for storing automation rules
CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    
    -- Trigger configuration
    trigger_event TEXT NOT NULL, -- Event type that triggers this automation (e.g., 'MEMBER_LEAVE')
    trigger_filters TEXT, -- JSON: conditions that must be met for trigger to fire
    
    -- Action configuration
    action_type TEXT NOT NULL, -- Action to perform (e.g., 'DELETE_MESSAGES', 'SEND_MESSAGE', 'ADD_ROLE')
    action_config TEXT NOT NULL, -- JSON: action-specific configuration
    
    -- Metadata
    created_by TEXT, -- User ID who created the automation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at DATETIME,
    trigger_count INTEGER DEFAULT 0
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_automations_guild_id ON automations(guild_id);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_event ON automations(trigger_event);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled);
CREATE INDEX IF NOT EXISTS idx_automations_guild_event ON automations(guild_id, trigger_event);

-- Automation execution logs
CREATE TABLE IF NOT EXISTS automation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    trigger_data TEXT, -- JSON: the event data that triggered the automation
    action_result TEXT, -- JSON: result of the action (success, errors, etc.)
    success INTEGER DEFAULT 1,
    error_message TEXT,
    execution_time_ms INTEGER, -- How long the action took
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation_id ON automation_logs(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_guild_id ON automation_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created_at ON automation_logs(created_at);

-- ============================================
-- AUTOMATION REFERENCE
-- ============================================
--
-- TRIGGER EVENTS (all EVENT_TYPES from logger.js):
-- Member: MEMBER_JOIN, MEMBER_LEAVE, MEMBER_UPDATE, MEMBER_BAN, MEMBER_UNBAN, MEMBER_KICK, MEMBER_TIMEOUT
-- Message: MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE, MESSAGE_BULK_DELETE
-- Voice: VOICE_JOIN, VOICE_LEAVE, VOICE_MOVE, VOICE_MUTE, VOICE_DEAFEN, VOICE_STREAM_START, VOICE_STREAM_END
-- Channel: CHANNEL_CREATE, CHANNEL_DELETE, CHANNEL_UPDATE
-- Role: ROLE_CREATE, ROLE_DELETE, ROLE_UPDATE, MEMBER_ROLE_ADD, MEMBER_ROLE_REMOVE
-- Etc...
--
-- ACTION TYPES:
-- DELETE_MESSAGES - Delete messages in a channel by a user
-- SEND_MESSAGE - Send a message to a channel
-- ADD_ROLE - Add a role to a user
-- REMOVE_ROLE - Remove a role from a user
-- KICK_MEMBER - Kick a member
-- BAN_MEMBER - Ban a member
-- TIMEOUT_MEMBER - Timeout a member
-- CREATE_THREAD - Create a thread
-- LOG_TO_CHANNEL - Log event details to a channel
--
-- TRIGGER FILTERS (JSON object with conditions):
-- {
--   "channel_id": "123456789", -- Only trigger in this channel
--   "actor_has_role": "123456789", -- Actor must have this role
--   "actor_missing_role": "123456789", -- Actor must NOT have this role
--   "content_contains": "word", -- Message content contains word
--   "content_regex": "pattern", -- Message content matches regex
--   "is_bot": false, -- Actor is/isn't a bot
--   "min_account_age_days": 7, -- Account must be at least X days old
-- }
--
-- ACTION CONFIG (JSON object with action-specific settings):
-- DELETE_MESSAGES: { "channel_id": "123", "limit": 100 }
-- SEND_MESSAGE: { "channel_id": "123", "content": "Hello {user.mention}!" }
-- ADD_ROLE: { "role_id": "123" }
-- REMOVE_ROLE: { "role_id": "123" }
-- KICK_MEMBER: { "reason": "Automated: {trigger.event}" }
-- BAN_MEMBER: { "reason": "Automated: {trigger.event}", "delete_days": 1 }
-- TIMEOUT_MEMBER: { "duration_minutes": 60, "reason": "Automated" }
-- LOG_TO_CHANNEL: { "channel_id": "123", "embed": true }
--
-- TEMPLATE VARIABLES (can be used in message content/reasons):
-- {user.id} - Actor's Discord ID
-- {user.name} - Actor's username
-- {user.mention} - Mention the actor
-- {user.tag} - Actor's tag (username#0000)
-- {target.id} - Target's Discord ID (if applicable)
-- {target.name} - Target's username
-- {target.mention} - Mention the target
-- {channel.id} - Channel ID where event occurred
-- {channel.name} - Channel name
-- {channel.mention} - Mention the channel
-- {guild.id} - Server ID
-- {guild.name} - Server name
-- {trigger.event} - The event type that triggered this
-- {trigger.category} - The event category
-- {trigger.time} - When the event occurred
-- {details.*} - Any field from the event details JSON

