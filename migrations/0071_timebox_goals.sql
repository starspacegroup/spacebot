-- Timebox goals: say what you are working on, then how much of it got done.
--
-- The goal and the percent are a member's own, so they live on
-- `timebox_participants` (one row per member per session), not on the session:
-- in a shared timebox everyone in the voice channel has their own. A row with a
-- goal but no deafen is fine; `deafen_mode` defaults to 'none'.
--
-- The command gains a `goal` option on `start`, and two subcommands: `goal`
-- (set or change it mid-timebox) and `progress` (the percent done, any time,
-- including after the timebox ended). The finished card also carries 0/25/50/75/100%
-- buttons. 0070 inserted the row, so this updates it, which keeps each guild's
-- built_in_command_overrides pointing at the same command id. Run
-- `bun run register-commands` afterwards so Discord learns the new options.

ALTER TABLE timebox_participants ADD COLUMN goal TEXT;
ALTER TABLE timebox_participants ADD COLUMN percent_done INTEGER;

UPDATE commands
SET options = '[{"name":"start","description":"Start a focus timer: alone, or for everyone in your voice channel","type":1,"options":[{"name":"goal","description":"What you want to get done in this timebox","type":3,"required":false,"max_length":200},{"name":"focus","description":"Minutes of focus per block (server default if blank)","type":4,"required":false,"min_value":1,"max_value":180},{"name":"break","description":"Minutes of break after a block","type":4,"required":false,"min_value":1,"max_value":60},{"name":"long_break","description":"Minutes of the long break after every fourth block","type":4,"required":false,"min_value":1,"max_value":120},{"name":"rounds","description":"How many focus blocks, then it finishes","type":4,"required":false,"min_value":1,"max_value":12},{"name":"deafen","description":"Server-deafen me while I focus. You can lift it any time with the button","type":3,"required":false,"choices":[{"name":"No","value":"none"},{"name":"During each focus block","value":"focus"},{"name":"Until the whole timebox ends","value":"whole"}]},{"name":"solo","description":"Just me, even if I''m in a voice channel","type":5,"required":false}]},{"name":"goal","description":"Set or change your goal for the timebox running here","type":1,"options":[{"name":"text","description":"What you want to get done","type":3,"required":true,"max_length":200}]},{"name":"progress","description":"Say how much of your goal you got done","type":1,"options":[{"name":"percent","description":"0 to 100","type":4,"required":true,"min_value":0,"max_value":100}]},{"name":"stop","description":"End the timebox running here","type":1},{"name":"status","description":"Show the timebox running here","type":1},{"name":"settings","description":"Defaults for this server (Crew only)","type":1,"options":[{"name":"focus","description":"Default minutes of focus","type":4,"required":false,"min_value":1,"max_value":180},{"name":"break","description":"Default minutes of break","type":4,"required":false,"min_value":1,"max_value":60},{"name":"long_break","description":"Default minutes of the long break","type":4,"required":false,"min_value":1,"max_value":120},{"name":"rounds","description":"Default number of focus blocks","type":4,"required":false,"min_value":1,"max_value":12},{"name":"control","description":"Who can pause, skip and stop a shared timebox","type":3,"required":false,"choices":[{"name":"The starter and Crew","value":"crew"},{"name":"Anyone in the voice channel","value":"anyone"}]}]}]',
    updated_at = CURRENT_TIMESTAMP
WHERE guild_id = '__built_in__' AND name = 'timebox';
