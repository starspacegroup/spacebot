-- Public server browser listings.
--
-- A guild appears in the public browser at /servers ONLY when an administrator
-- explicitly opts in: `listed` defaults to 0 and nothing writes a row until an
-- admin saves the listing form. A guild with no row here is unlisted.
--
-- Everything published here is admin-authored (headline/description/tags) or
-- admin-gated (member count via show_member_count); the browser never derives
-- public content from member activity.

CREATE TABLE IF NOT EXISTS guild_listings (
    guild_id TEXT PRIMARY KEY,

    -- Opt-in switch. Default OFF — publishing is always a deliberate action.
    listed INTEGER NOT NULL DEFAULT 0,

    -- Admin-authored public copy
    headline TEXT,                       -- short pitch, <= 120 chars
    description TEXT,                    -- long form, <= 1000 chars
    category TEXT,                       -- one of the slugs in server-listings.ts
    tags TEXT NOT NULL DEFAULT '[]',     -- JSON array of short tag strings

    -- Join link. Validated to discord.gg / discord.com/invite URLs only so the
    -- browser can't be used to point visitors at arbitrary third-party sites.
    invite_url TEXT,

    -- Per-field disclosure toggles
    show_member_count INTEGER NOT NULL DEFAULT 1,

    -- Self-declared 18+ so the browser can badge/filter it
    nsfw INTEGER NOT NULL DEFAULT 0,

    -- Operator moderation. 'approved' (default) is live; 'rejected' hides the
    -- listing without touching the admin's own opt-in state.
    review_status TEXT NOT NULL DEFAULT 'approved',
    review_note TEXT,

    listed_at DATETIME,                  -- first time it went public
    submitted_by TEXT,                   -- discord user id of the last editor
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The browser's only hot query filters on (listed, review_status) and orders by
-- listed_at; keep it off a full table scan (see the D1 rows-read notes in ROADMAP).
CREATE INDEX IF NOT EXISTS idx_guild_listings_public
    ON guild_listings(listed, review_status, listed_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_listings_category
    ON guild_listings(category);
