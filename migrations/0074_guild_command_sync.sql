-- What each server's slash commands looked like the last time we sent them to Discord.
--
-- `payload_hash` is a hash of the exact command list sent in the bulk overwrite.
-- A sweep rebuilds that list every so often and compares: if it differs (a
-- migration changed a built-in command's options, the code changed how a
-- command is registered, a role rule moved a permission gate) the server is
-- synced again. Nobody has to run `register-commands` or press Register.
--
-- `checked_at` orders the sweep so every server gets looked at in turn.
-- `attempted_at` / `last_error` stop a server the bot has left from failing
-- every minute: a failed sync waits before it is tried again.

CREATE TABLE IF NOT EXISTS guild_command_sync (
	guild_id TEXT PRIMARY KEY,
	payload_hash TEXT,
	synced_at TEXT,
	checked_at TEXT,
	attempted_at TEXT,
	last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_guild_command_sync_checked ON guild_command_sync(checked_at);
