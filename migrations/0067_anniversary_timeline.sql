-- Anniversary timelines: post a historical day's events at the minutes they
-- happened, on its anniversary, in a channel the server owner chooses.
--
-- The first (and for now only) timeline is September 11, 2001. A server that
-- turns it on gets each event posted as that time comes round in New York --
-- 8:46 AM at 8:46 AM -- so the day is read at the pace it was lived rather
-- than as one block of text nobody finishes.
--
-- OFF for every guild by default, and there is no "enable for all" path. A
-- commemoration is the server owner's to hold, not the platform's to schedule
-- on their behalf, so `enabled` starts at 0 and only the dashboard sets it.
--
-- Why a `timeline_key` column when one timeline ships: the alternative is a
-- boolean called something like `september_11_enabled`, and the day a second
-- observance is added that column is either renamed (breaking anything
-- reading it) or joined by a near-duplicate. The key costs nothing now and
-- means the schema does not move later. Timeline CONTENT stays in code
-- (`src/lib/anniversaries.ts`), not in these rows -- it is the same for every
-- guild, and a historical record that can be edited per-server is a liability,
-- not a feature.

CREATE TABLE IF NOT EXISTS anniversary_timelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    timeline_key TEXT NOT NULL DEFAULT 'september-11-2001',

    enabled INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT,

    -- Which clock the times are read against. Defaults to the zone the events
    -- happened in, so 8:46 means the 8:46 that is in the history books. A
    -- server that would rather have the day land on its own members' clocks
    -- sets its own zone here; both readings are defensible, so it is a choice
    -- rather than a hardcoded assumption.
    timezone TEXT NOT NULL DEFAULT 'America/New_York',

    -- How late an event may still be posted. The dispatcher ticks once a
    -- minute, but ticks get missed -- a deploy, a queue backlog, a Cloudflare
    -- incident. Without a bound, an outage from 9 AM to noon would dump three
    -- hours of a memorial into the channel at once, out of order with the day
    -- and jarring to read. Past this many minutes an event is recorded as
    -- 'skipped' instead: silent, visible in the log, never a burst.
    grace_minutes INTEGER NOT NULL DEFAULT 15,

    -- Presentation. Embeds read better for something sombre and keep the
    -- timestamp attached; plain text is there for servers that strip embeds.
    use_embed INTEGER NOT NULL DEFAULT 1,
    embed_color INTEGER,                      -- NULL = the timeline's own colour

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One configuration per timeline per guild.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anniversary_timelines_guild_key
    ON anniversary_timelines(guild_id, timeline_key);

-- The per-minute scan's only query: enabled rows. Kept narrow because this
-- runs 1,440 times a day forever to do nothing on 364 of 365 days, and D1
-- rows-read is the cost that bites on this account (see the note above
-- idx_managed_channels_reap in 0060).
CREATE INDEX IF NOT EXISTS idx_anniversary_timelines_enabled
    ON anniversary_timelines(enabled, timeline_key);

-- One row per event per guild per year. This table is the lock, not a report:
-- the unique index below is what stops the same minute being posted twice when
-- two ticks overlap or a Workflow step retries. The dispatcher claims a row
-- with INSERT OR IGNORE and only posts if the insert actually happened, so the
-- winner of the race is decided by SQLite rather than by timing.
CREATE TABLE IF NOT EXISTS anniversary_timeline_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timeline_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    event_key TEXT NOT NULL,

    -- claimed -> sent | failed | skipped.
    -- 'claimed' that never moved means the process died mid-post; it is left
    -- alone rather than retried, because the message may well have landed and
    -- a duplicate is worse than a gap on this of all days.
    status TEXT NOT NULL DEFAULT 'claimed',
    message_id TEXT,
    error TEXT,

    claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,

    FOREIGN KEY (timeline_id) REFERENCES anniversary_timelines(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anniversary_posts_once
    ON anniversary_timeline_posts(timeline_id, year, event_key);

CREATE INDEX IF NOT EXISTS idx_anniversary_posts_year
    ON anniversary_timeline_posts(timeline_id, year);
