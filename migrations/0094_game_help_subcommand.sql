-- `/game help` (and `/play help`): the games' rules for anyone, private to whoever asked
-- (David, 2026-11-05). Adds a `help` subcommand to the built-in /game. Rows that already carry it
-- are left alone. The sync sends the change to every server, which also covers /play, built as a
-- copy of /game.
UPDATE commands
   SET options = substr(options, 1, length(options) - 1) ||
       ',{"name":"help","description":"How the games work: the rules, and what is happening now","type":1}]'
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND options LIKE '%"name":"shiritori"%'
   AND options NOT LIKE '%"name":"help"%'
   AND substr(options, -1) = ']';
