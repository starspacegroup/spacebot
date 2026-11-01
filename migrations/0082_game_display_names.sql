-- Per-server names for the games (docs/activity.md, "Names on this server").
--
-- A server can call Hidden Agent "Impostor" and Shiritori "Word Chain". One row
-- per server per game id from `src/lib/games/registry.ts`; no row, or a NULL
-- column, means the registry's default. Values are cleaned before they are
-- stored (`src/lib/games/display.ts`): no mentions, links, markdown or control
-- characters, so a name can go straight into a Discord message.
--
-- Slash command names do not change: Discord would need the commands
-- re-registered under new names, and members type what the docs say.

CREATE TABLE IF NOT EXISTS game_display_names (
    guild_id TEXT NOT NULL,
    game_id TEXT NOT NULL,              -- a registry id: 'agent', 'shiritori'
    name TEXT,                          -- 1–40 chars; NULL: the default name
    icon TEXT,                          -- one emoji; NULL: the default icon
    tagline TEXT,                       -- 1–120 chars; NULL: the default tagline
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, game_id)
);
