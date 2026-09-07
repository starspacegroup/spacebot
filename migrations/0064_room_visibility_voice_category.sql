-- Member rooms: their own category, public/private, and a speaking mode.
--
-- Three things a room needs to be decided at creation, not patched afterwards.
--
-- 1. Category. `parent_id` only ever pointed at a category an admin made by
--    hand, so a server that skipped that step got its rooms scattered through
--    the channel list. `category_mode = 'own'` hands the job to the bot: it
--    makes the category on first use, reuses it, and rolls over to another one
--    at Discord's 50-children-per-category cap. The ids it has made live in
--    `managed_category_ids`, oldest first.
--
-- 2. Visibility. Whether @everyone may see and join the room. Previously fixed
--    for a whole guild by `everyone_deny`; that column stays as the admin's
--    extra denies and visibility now owns VIEW_CHANNEL/CONNECT. Existing
--    presets deny both and default to 'private', so nothing changes for them.
--
-- 3. Voice mode. 'open' is Discord's default; 'ptt' denies USE_VAD so the room
--    forces push-to-talk; 'listen' denies SPEAK for everyone but the owner, who
--    hands out the mic with /room unmute.
--
-- Each of the three has a default the admin sets and a flag for whether the
-- member creating the room may override it. A join-to-create lobby has nobody
-- to ask, so it always takes the default.

ALTER TABLE channel_presets ADD COLUMN category_mode TEXT NOT NULL DEFAULT 'existing';
ALTER TABLE channel_presets ADD COLUMN category_name TEXT;
ALTER TABLE channel_presets ADD COLUMN managed_category_ids TEXT NOT NULL DEFAULT '[]';

ALTER TABLE channel_presets ADD COLUMN default_visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE channel_presets ADD COLUMN allow_visibility_choice INTEGER NOT NULL DEFAULT 1;

ALTER TABLE channel_presets ADD COLUMN default_voice_mode TEXT NOT NULL DEFAULT 'open';
ALTER TABLE channel_presets ADD COLUMN allow_voice_mode_choice INTEGER NOT NULL DEFAULT 1;

-- What the room was actually created as, so a verb and the dashboard can read
-- it back without re-deriving it from the live overwrites.
ALTER TABLE managed_channels ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE managed_channels ADD COLUMN voice_mode TEXT NOT NULL DEFAULT 'open';

-- Rooms created before this migration were all private and all 'open'; the
-- column defaults already say so.

-- A listen-only room is useless if the owner cannot hand the microphone back,
-- so existing presets get the two new verbs. They stay inert until somebody
-- uses them: a room in 'open' mode behaves exactly as it did. An admin who does
-- not want owners muting anybody unticks them under Server → Member Rooms.
UPDATE channel_presets
SET owner_can = json_insert(
        json_insert(owner_can, '$[#]', 'mute'),
        '$[#]', 'unmute'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE json_valid(owner_can)
  AND owner_can NOT LIKE '%"mute"%';
