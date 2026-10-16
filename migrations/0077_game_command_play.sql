-- The Game command is /play, not /game. /game belongs to the *Space Game
-- integration (starspace-game), and /play says what you do. 0076 stays as it
-- was applied; this renames the built-in row. Per-server overrides point at the
-- command id, so they keep working. A server that already has the integration's
-- /game is left alone.
UPDATE commands
   SET name = 'play'
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND NOT EXISTS (SELECT 1 FROM commands WHERE guild_id = '__built_in__' AND name = 'play');
