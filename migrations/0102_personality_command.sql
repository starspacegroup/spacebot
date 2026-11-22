-- /personality: links to free online personality tests (Myers-Briggs style, Big Five, autism,
-- BDSM, attachment and more). A built-in handled by the interactions route
-- (src/lib/server/personality-command.ts), OFF until a server turns it on from Commands
-- (enabled = 0, the same way /topic ships). Every test shows by default; a server hides some
-- (personality_hidden) or adds its own links (personality_custom).
INSERT OR IGNORE INTO commands (
    guild_id, name, description, enabled, is_built_in,
    options, ephemeral, defer,
    action_type, action_config,
    response_type, response_content, response_embed,
    created_by
) VALUES (
    '__built_in__', 'personality', 'Links to free online personality tests', 0, 1,
    '[{"name":"list","description":"See the personality tests this server shows","type":1,"options":[{"name":"category","description":"Only one kind (all of them if blank)","type":3,"required":false,"choices":[{"name":"Type & temperament","value":"type"},{"name":"Big Five & traits","value":"traits"},{"name":"Autism & neurodiversity","value":"neuro"},{"name":"Relationships & intimacy","value":"relationships"},{"name":"Dark traits","value":"dark"},{"name":"Career & strengths","value":"career"},{"name":"Values & politics","value":"values"},{"name":"Just for fun","value":"fun"},{"name":"More tests","value":"hubs"}]}]},{"name":"find","description":"Find a test by name or topic, like autism or enneagram","type":1,"options":[{"name":"search","description":"A name or topic","type":3,"required":true,"max_length":60}]},{"name":"hide","description":"Stop showing a test in this server (Manage Server only)","type":1,"options":[{"name":"test","description":"The test''''s name","type":3,"required":true,"max_length":60}]},{"name":"show","description":"Show a hidden test again (Manage Server only)","type":1,"options":[{"name":"test","description":"The test''''s name","type":3,"required":true,"max_length":60}]},{"name":"reset","description":"Show every built-in test again (Manage Server only)","type":1},{"name":"add","description":"Add your own link to the list (Manage Server only)","type":1,"options":[{"name":"name","description":"What it is called","type":3,"required":true,"max_length":60},{"name":"link","description":"The https link","type":3,"required":true,"max_length":300},{"name":"category","description":"Where it goes in the list","type":3,"required":false,"choices":[{"name":"Type & temperament","value":"type"},{"name":"Big Five & traits","value":"traits"},{"name":"Autism & neurodiversity","value":"neuro"},{"name":"Relationships & intimacy","value":"relationships"},{"name":"Dark traits","value":"dark"},{"name":"Career & strengths","value":"career"},{"name":"Values & politics","value":"values"},{"name":"Just for fun","value":"fun"},{"name":"More tests","value":"hubs"}]},{"name":"note","description":"A short note","type":3,"required":false,"max_length":120}]},{"name":"remove","description":"Remove one of your own links (Manage Server only)","type":1,"options":[{"name":"number","description":"Its number from /personality manage","type":4,"required":true,"min_value":1}]},{"name":"manage","description":"Show what is hidden and your own links (Manage Server only)","type":1}]',
    0, 0,
    'NONE', '{}',
    'action_only', NULL, NULL,
    'system'
);

-- A built-in test a server chose not to show. No row means it shows.
CREATE TABLE IF NOT EXISTS personality_hidden (
    guild_id TEXT NOT NULL,
    test_id TEXT NOT NULL,
    hidden_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, test_id)
);

-- A server's own links, added by people with Manage Server.
CREATE TABLE IF NOT EXISTS personality_custom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'hubs',
    note TEXT,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personality_custom_guild ON personality_custom(guild_id);
