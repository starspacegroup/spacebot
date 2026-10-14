-- Quorum auto-actions: a question can carry something to do if it passes.
--
-- `/quorum ask then: name: if_yes:` stores the action on the question. When the
-- question closes with quorum reached and yes at or above `auto_threshold`
-- percent of the yes + no votes, the sweep does it (today: create a voice or a
-- text channel) and records the outcome here. Abstentions count toward quorum
-- but not toward the threshold, as they do not count toward the decision.
--
-- `auto_status` is NULL until the question closes, then 'done' (carried out),
-- 'failed' (it passed but Discord refused; the reason is posted in the
-- channel) or 'not_met' (it did not pass, so nothing was done).
-- `auto_channel_id` is the channel that was created.
--
-- The whole feature is **off by default** and only the server owner can turn it
-- on: `quorum_settings.auto_actions` on the guild row (channel_id ''), set with
-- `/quorum settings auto_actions:True`. It is checked when a question is asked
-- and again when it closes, so switching it off stops one already in flight.
-- `auto_status` is also 'disabled' for a question that passed while it was off.
--
-- 0069 inserted the command row, so this updates it, which keeps each guild's
-- built_in_command_overrides pointing at the same command id. Run
-- `bun run register-commands` afterwards so Discord learns the new options.

ALTER TABLE quorum_questions ADD COLUMN auto_action TEXT;
ALTER TABLE quorum_questions ADD COLUMN auto_name TEXT;
ALTER TABLE quorum_questions ADD COLUMN auto_threshold INTEGER;
ALTER TABLE quorum_questions ADD COLUMN auto_status TEXT;
ALTER TABLE quorum_questions ADD COLUMN auto_channel_id TEXT;
ALTER TABLE quorum_settings ADD COLUMN auto_actions INTEGER NOT NULL DEFAULT 0;

UPDATE commands
SET options = '[{"name":"ask","description":"Ask a yes/no question that closes by itself","type":1,"options":[{"name":"question","description":"The question, answerable yes or no","type":3,"required":true,"max_length":240},{"name":"closes","description":"How long it stays open, e.g. 24h, 90m, 2d (channel default if blank)","type":3,"required":false},{"name":"quorum","description":"Votes needed for a result (channel default if blank)","type":4,"required":false,"min_value":1,"max_value":10000},{"name":"owner","description":"Who follows through on the result (you, if blank)","type":9,"required":false},{"name":"due","description":"How long after closing the owner has, e.g. 7d (default 7d)","type":3,"required":false},{"name":"class","description":"What kind of decision this is","type":3,"required":false,"choices":[{"name":"General","value":"general"},{"name":"Owner-only","value":"owner-only"},{"name":"Money","value":"money"},{"name":"Access / roles","value":"access"},{"name":"Legal","value":"legal"}]},{"name":"then","description":"Do this automatically if the vote passes (needs Manage Channels)","type":3,"required":false,"choices":[{"name":"Create a voice channel","value":"voice_channel"},{"name":"Create a text channel","value":"text_channel"}]},{"name":"name","description":"Name for the channel that gets created (needed with then)","type":3,"required":false,"max_length":100},{"name":"if_yes","description":"Percent of yes and no votes that must be yes, 51 to 100 (default 66)","type":4,"required":false,"min_value":51,"max_value":100}]},{"name":"close","description":"End a question early (asker or Crew)","type":1,"options":[{"name":"id","description":"Question number (the latest open one here if blank)","type":4,"required":false,"min_value":1}]},{"name":"results","description":"Repost the last result in this channel","type":1},{"name":"log","description":"Past decisions, newest first","type":1},{"name":"veto","description":"Stop a decision, with a public reason (server owner only)","type":1,"options":[{"name":"id","description":"Question number","type":4,"required":true,"min_value":1},{"name":"reason","description":"One line of why","type":3,"required":true,"max_length":300}]},{"name":"settings","description":"Defaults for this channel (Crew only)","type":1,"options":[{"name":"closes","description":"Default open time, e.g. 24h","type":3,"required":false},{"name":"quorum","description":"Default votes needed","type":4,"required":false,"min_value":1,"max_value":10000},{"name":"footer","description":"Footer on every RESULT card (server-wide)","type":3,"required":false,"max_length":120},{"name":"announce","description":"Channel to mirror results into (server-wide)","type":7,"required":false},{"name":"protect","description":"Comma-separated classes to refuse: owner-only, money, access, legal, or none (server-wide)","type":3,"required":false},{"name":"lock","description":"Lock the protected list so only the owner can change it (owner only)","type":5,"required":false},{"name":"auto_actions","description":"Let questions do something automatically when they pass (server-wide, owner only, off by default)","type":5,"required":false}]}]',
    updated_at = CURRENT_TIMESTAMP
WHERE guild_id = '__built_in__' AND name = 'quorum';
