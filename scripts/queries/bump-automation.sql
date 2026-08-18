-- Why didn't the bump automation fire?
--
-- Disboard defers its reply: the MESSAGE_CREATE arrives empty and the "Bump
-- done!" embed only lands on the subsequent edit. So a bump automation has to
-- trigger on SLASH_COMMAND_USE (fires on the create) or SLASH_COMMAND_RESPONSE
-- (fires on the edit, once the embed is there) — never on MESSAGE_CREATE with a
-- content filter, which cannot match.
--
-- Set the guild id below, then: bun run db:query --file scripts/queries/bump-automation.sql
SELECT
    'automation' AS kind,
    a.name       AS a,
    a.enabled    AS b,
    a.trigger_events AS c,
    substr(a.trigger_filters, 1, 200) AS d
FROM automations a
WHERE a.guild_id = 'GUILD_ID_HERE'
  AND (lower(a.name) LIKE '%bump%' OR a.trigger_events LIKE '%SLASH_COMMAND%')

UNION ALL

SELECT
    'event',
    e.created_at,
    e.event_type,
    e.actor_name,
    substr(e.details, 1, 200)
FROM event_logs e
WHERE e.guild_id = 'GUILD_ID_HERE'
  AND (e.event_type LIKE 'SLASH_COMMAND%' OR lower(e.details) LIKE '%bump%')
  AND e.created_at >= datetime('now', '-3 days')

ORDER BY 1, 2 DESC
LIMIT 60;
