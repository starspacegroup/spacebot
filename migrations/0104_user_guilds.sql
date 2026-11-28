-- Which servers each signed-in person is in, and what standing they have there.
-- Filled from the Discord guild list the dashboard already loads, for servers the bot is in.
-- The superadmin pages read it to show a user's servers and a server's people.
CREATE TABLE IF NOT EXISTS user_guilds (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    standing TEXT NOT NULL CHECK (standing IN ('owner', 'admin', 'manager', 'member')),
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_user_guilds_guild ON user_guilds(guild_id, standing);
