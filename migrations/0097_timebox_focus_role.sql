-- Timebox: a role the bot owns, so it and a server's own automations do not
-- step on each other.
--
-- The deafen ledger (0070) records what a member's deafen and mute were before
-- the bot touched them. That does not say who holds them *now*: if an
-- automation deafens the same member later, the timebox's lift at the end undoes
-- the automation's deafen too. So the bot now marks its own hold with a role.
--
-- `timebox_settings.focus_role_id` is that role, created by the bot the first
-- time it holds someone in a server (no permissions, not shown apart, not
-- mentionable). `timebox_participants.role_added` says the bot put the role on
-- this member for this session; the lift only touches the member's voice state
-- while the role is still on them, and removes it afterwards. A row from before
-- this migration has role_added = 0 and behaves as it always did.

ALTER TABLE timebox_settings ADD COLUMN focus_role_id TEXT;
ALTER TABLE timebox_participants ADD COLUMN role_added INTEGER NOT NULL DEFAULT 0;

-- Places where the server itself keeps members muted and deafened (a voice channel
-- where everyone must always be, held by an automation). The timebox never lifts a
-- member's deafen or mute while they are in one of these channels or have one of
-- these roles, even if they asked for the timebox deafen. Both are JSON arrays of
-- ids; NULL means none. Set from the dashboard, Activity page, Timebox.
ALTER TABLE timebox_settings ADD COLUMN no_lift_channels TEXT;
ALTER TABLE timebox_settings ADD COLUMN no_lift_roles TEXT;
