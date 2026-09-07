-- The public channel directory, as the gateway sees it.
--
-- WHAT GOES IN HERE IS PUBLIC. The gateway sends only channels the @everyone
-- role can view, and /api/channels/sync drops rooms members made with /room.
-- Both filters run before the write rather than at the API, so no future
-- endpoint can leak a staff channel by forgetting a WHERE clause — the same
-- reason live voice drops member names in the database layer, not a component.
--
-- Rows are a full replacement per guild on every sync, so a channel that is
-- deleted, renamed, or made private simply stops arriving and is removed.
CREATE TABLE IF NOT EXISTS guild_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,

    name TEXT NOT NULL,
    -- Discord's numeric channel type: 0 text, 2 voice, 4 category,
    -- 5 announcement, 13 stage, 15 forum, 16 media.
    type INTEGER NOT NULL,
    -- The channel's own description, as set in Discord. Usually the best
    -- available answer to "what is this for", and often empty.
    topic TEXT,
    -- Category this channel sits under, and its name denormalised so a reader
    -- can group without a second query.
    parent_id TEXT,
    parent_name TEXT,
    -- Discord's ordering within the category. Sorting by it reproduces the
    -- sidebar, which is the order members already know.
    position INTEGER NOT NULL DEFAULT 0,

    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_channels_guild ON guild_channels(guild_id, position);
