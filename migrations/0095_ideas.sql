-- The idea box (David, 2026-11-07): anyone signed in with Discord can tell SpaceBot how to get
-- better, from the /ideas page or the /idea command. Every idea keeps who sent it and when.
-- Plan and reasons: planning/IDEA_BOX_PLAN.md in the workspace repo; behaviour: docs/ideas.md.
--
-- Two sets of scores sit side by side. The `ai_*` columns are the model's draft; `impact`,
-- `reach`, `effort`, `confidence` are the superadmin's final call. `score` is the rank, stored
-- so the list can sort on an index, and `score_source` says which set it came from
-- ('admin' once the superadmin has scored it, 'ai' for a draft, NULL for neither).
-- `user_id` and `user_name` are cleared (NULL) when a sender asks to have their name removed;
-- the idea text stays.
CREATE TABLE IF NOT EXISTS ideas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('web', 'command')),
    user_id       TEXT,
    user_name     TEXT,
    guild_id      TEXT,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    area          TEXT NOT NULL DEFAULT 'other',
    status        TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'reviewing', 'planned', 'shipped', 'declined', 'duplicate')),
    duplicate_of  INTEGER,
    shipped_ref   TEXT,
    admin_note    TEXT,

    ai_summary    TEXT,
    ai_impact     INTEGER,
    ai_reach      INTEGER,
    ai_effort     TEXT,
    ai_confidence INTEGER,
    ai_risk       INTEGER NOT NULL DEFAULT 0,
    ai_reasoning  TEXT,
    ai_duplicates TEXT,
    ai_scored_at  TEXT,

    impact        INTEGER,
    reach         INTEGER,
    effort        TEXT,
    confidence    INTEGER,
    risk          INTEGER NOT NULL DEFAULT 0,
    scored_by     TEXT,
    scored_at     TEXT,

    score         REAL NOT NULL DEFAULT 0,
    score_source  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ideas_status_score ON ideas (status, score DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_user_created ON ideas (user_id, created_at);

-- The superadmin can stop one person from sending ideas.
CREATE TABLE IF NOT EXISTS idea_bans (
    user_id    TEXT PRIMARY KEY,
    reason     TEXT,
    created_at TEXT NOT NULL
);
