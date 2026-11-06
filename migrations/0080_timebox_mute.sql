-- Timebox "Deafen me" now server-mutes as well as server-deafens. Same ledger
-- rule as prev_deaf: remember what the member's server-mute was before the bot
-- touched it, so a moderator's mute is never lifted.
ALTER TABLE timebox_participants ADD COLUMN prev_mute INTEGER NOT NULL DEFAULT 0;
