-- `/game shiritori rules:True` posts the Shiritori rules in the channel and pins them
-- (managers only; the handler checks). Adds the option after `off` from 0087.
-- Rows already carrying it, or without the 0087 option, are left alone.
UPDATE commands
   SET options = replace(
         options,
         '"name":"off","description":"Managers only: turn the always-on Shiritori chain off","type":5,"required":false}]}',
         '"name":"off","description":"Managers only: turn the always-on Shiritori chain off","type":5,"required":false},{"name":"rules","description":"Managers only: post the Shiritori rules here and pin them","type":5,"required":false}]}')
 WHERE guild_id = '__built_in__' AND name = 'game' AND is_built_in = 1
   AND options LIKE '%"name":"off"%'
   AND options NOT LIKE '%"name":"rules"%';
