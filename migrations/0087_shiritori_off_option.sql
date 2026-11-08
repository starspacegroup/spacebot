-- `/game shiritori off:True` stops the always-on chain (clears the chain channel), the
-- counterpart of `channel:` from 0086. Managers only; the handler checks that.
-- Rows already carrying the option, or without the 0086 channel option, are left alone.
UPDATE commands
   SET options = replace(
         options,
         '"channel_types":[0,5],"required":false}]}',
         '"channel_types":[0,5],"required":false},{"name":"off","description":"Managers only: turn the always-on Shiritori chain off","type":5,"required":false}]}')
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND options LIKE '%"name":"channel"%'
   AND options NOT LIKE '%"name":"off"%';
