-- One /game for every game (David, 2026-11-01). 0077 renamed the built-in Game
-- command to /play because /game belonged to the *Space Game integration; now
-- the built-in row is /game again and holds the hidden-agent round, Shiritori
-- and, where a server has the integration on, the integration's own /game
-- subcommands (merged at sync time, src/lib/discord/game-command.ts). /play
-- stays as a synonym: the sync sends a copy of /game named /play, and the
-- interactions route reads /play as /game. The row keeps its id, so per-server
-- overrides (enable switch, permissions, role rules) carry over.
UPDATE commands
   SET name = 'game',
       description = 'Games for the server: a hidden-agent round, Shiritori and more',
       options = '[{"name":"start","description":"Open a hidden-agent lobby for the voice channel you are in","type":1},{"name":"stop","description":"End the hidden-agent round here (the starter or Crew)","type":1},{"name":"status","description":"Show the hidden-agent round here","type":1},{"name":"shiritori","description":"Open a Shiritori word-chain round in this channel","type":1}]'
 WHERE guild_id = '__built_in__' AND name = 'play' AND is_built_in = 1
   AND NOT EXISTS (SELECT 1 FROM commands WHERE guild_id = '__built_in__' AND name = 'game');
