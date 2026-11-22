-- Repair for 0083 (found 2026-11-04, *Space showed no Shiritori in /game or /play).
-- 0083 renames the built-in `play` row to `game` only when no built-in `game` row
-- exists. Production already had an old hidden-agent `game` row, so the rename was
-- skipped: `game` kept three subcommands without `shiritori`, and a stale `play` row
-- kept the Shiritori option. The sync builds /play as a copy of /game, so Discord got
-- no Shiritori at all.
--
-- Fix: carry the stale row's per-server overrides over to the `game` row, give the
-- `game` row the unified description and options, then drop the stale `play` row.
-- A database where 0083 already worked has no stale row and no change here.
INSERT OR IGNORE INTO built_in_command_overrides
       (guild_id, command_id, enabled, default_member_permissions, access_rules)
SELECT o.guild_id, g.id, o.enabled, o.default_member_permissions, o.access_rules
  FROM built_in_command_overrides o
  JOIN commands p ON p.id = o.command_id
   AND p.guild_id = '__built_in__' AND p.name = 'play' AND p.is_built_in = 1
  JOIN commands g ON g.guild_id = '__built_in__' AND g.name = 'game' AND g.is_built_in = 1;

UPDATE commands
   SET description = 'Games for the server: a hidden-agent round, Shiritori and more',
       options = '[{"name":"start","description":"Open a hidden-agent lobby for the voice channel you are in","type":1},{"name":"stop","description":"End the hidden-agent round here (the starter or Crew)","type":1},{"name":"status","description":"Show the hidden-agent round here","type":1},{"name":"shiritori","description":"Open a Shiritori word-chain round in this channel","type":1}]'
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND options NOT LIKE '%shiritori%';

DELETE FROM built_in_command_overrides
 WHERE command_id IN (
       SELECT p.id FROM commands p
        WHERE p.guild_id = '__built_in__' AND p.name = 'play' AND p.is_built_in = 1
          AND EXISTS (SELECT 1 FROM commands g
                       WHERE g.guild_id = '__built_in__' AND g.name = 'game' AND g.is_built_in = 1));

DELETE FROM commands
 WHERE guild_id = '__built_in__' AND name = 'play' AND is_built_in = 1
   AND EXISTS (SELECT 1 FROM commands g
                WHERE g.guild_id = '__built_in__' AND g.name = 'game' AND g.is_built_in = 1);
