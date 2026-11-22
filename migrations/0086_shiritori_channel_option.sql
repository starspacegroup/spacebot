-- `/game shiritori` gets an optional `channel` option: a server manager picks the
-- always-on chain channel from Discord instead of the dashboard. The handler checks
-- the member's permission itself (the "manage commands" setting), so the option is
-- visible to everyone who can run /game and only works for those allowed.
-- Rows already carrying the option, or without a Shiritori subcommand, are left alone.
UPDATE commands
   SET options = replace(
         options,
         '"description":"Open a Shiritori word-chain round in this channel","type":1}',
         '"description":"Open a Shiritori word-chain round in this channel","type":1,"options":[{"name":"channel","description":"Managers only: make this text channel the always-on Shiritori chain","type":7,"channel_types":[0,5],"required":false}]}')
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND options LIKE '%"name":"shiritori"%'
   AND options NOT LIKE '%"name":"channel"%';
