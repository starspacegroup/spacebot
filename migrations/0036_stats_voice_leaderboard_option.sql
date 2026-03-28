-- Add Voice Leaderboard option to built-in /stats command choices
UPDATE commands
SET options = json_set(
  options,
  '$[0].choices',
  json_insert(
    json_extract(options, '$[0].choices'),
    '$[#]',
    json('{"name":"Voice Leaderboard","value":"voice_leaderboard"}')
  )
)
WHERE guild_id = '__built_in__'
  AND name = 'stats'
  AND json_type(options, '$[0].choices') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(json_extract(options, '$[0].choices'))
    WHERE json_extract(json_each.value, '$.value') = 'voice_leaderboard'
  );

-- Keep built-in /stats command description aligned with chart + leaderboard support
UPDATE commands
SET description = 'Show server stats charts and voice leaderboards'
WHERE guild_id = '__built_in__'
  AND name = 'stats';
