# Querying production

`bun run db:query` runs a **read-only** query against the production D1 database
(`spacebot-logs`). It exists so that "why didn't that fire?" can be answered by
looking, instead of guessed at from the source.

```bash
bun run db:query "SELECT id, name, enabled FROM automations WHERE guild_id = '123'"
bun run db:query --json "SELECT event_type, COUNT(*) c FROM event_logs GROUP BY 1"
bun run db:query --file scripts/queries/bump-automation.sql
```

## It cannot write

The statement is parsed before any request is made. Anything that is not a
`SELECT` / `WITH…SELECT` / `EXPLAIN` / `PRAGMA table_info` is refused, and so is
any statement containing a mutating keyword — including one buried in a CTE
(`WITH x AS (DELETE … RETURNING 1)` is valid SQLite) or `PRAGMA writable_schema`.

This is the point of the tool, not a limitation of it. A read-only key means
production can be inspected freely, by anyone, at any time, without a review
step — because the worst case is a slow query. Schema and data changes keep going
through `migrations/`, applied by the Pages build. See the migration rules in
`CLAUDE.md`.

## Setting up the token

The day-to-day `CLOUDFLARE_API_TOKEN` does not carry D1 permissions — it returns
`7403 The given account is not valid or is not authorized to access this
service`. Rather than widening it, mint a separate read-only key:

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Custom token**
2. Permissions: **Account** · **D1** · **Read**
3. Account Resources: **Include** · your account
4. Create, copy, and add it to `.env`:

    ```
    CLOUDFLARE_D1_TOKEN=...
    ```

`db:query` prefers `CLOUDFLARE_D1_TOKEN` and falls back to
`CLOUDFLARE_API_TOKEN`, so nothing else needs changing. `.env` is gitignored.

## Diagnostics worth knowing

**Did the gateway ever see the event?** If nothing comes back here, the problem
is upstream of automations entirely — the gateway either isn't receiving the
event or isn't logging it, and no amount of automation config will help.

```sql
SELECT created_at, event_type, actor_name, target_name,
       substr(details, 1, 200) AS details
FROM event_logs
WHERE guild_id = ? AND created_at >= datetime('now', '-1 day')
ORDER BY created_at DESC LIMIT 50;
```

**Did an automation match, and what did it do?** `automation_logs` records
executions; an automation that never matched has no row at all, which is the
distinction that matters when something "didn't trigger".

```sql
SELECT l.created_at, a.name, l.status, substr(l.error_message, 1, 200) AS error
FROM automation_logs l JOIN automations a ON a.id = l.automation_id
WHERE a.guild_id = ? ORDER BY l.created_at DESC LIMIT 50;
```

**What is the automation actually configured as?** Trigger events and filters are
JSON columns; the trigger being one event when you assumed another is the single
most common cause of a silent no-op.

```sql
SELECT id, name, enabled, trigger_events, trigger_filters, action_type
FROM automations WHERE guild_id = ?;
```

**Gateway health.** `gateway_logs` carries what the process itself reported.

```sql
SELECT created_at, level, substr(message, 1, 300) AS message
FROM gateway_logs ORDER BY created_at DESC LIMIT 100;
```
