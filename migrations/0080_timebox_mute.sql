-- Timebox "Deafen me" now server-mutes as well as server-deafens. Same ledger
-- rule as prev_deaf: remember what the member's server-mute was before the bot
-- touched it, so a moderator's mute is never lifted.
-- The default is 1 ("was already muted, leave it alone"): a row applied before
-- this column existed never muted the member, so the timer must not unmute them.
-- applyDeafen writes the real value every time it applies a timebox.
ALTER TABLE timebox_participants ADD COLUMN prev_mute INTEGER NOT NULL DEFAULT 1;
