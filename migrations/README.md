# Database Migrations

## ⚠️ IMPORTANT: Do NOT modify existing migration files

All migration files in this directory have been applied to production. **They are immutable.** Editing them will have no effect on already-migrated databases and will cause the schema to diverge from the migration history.

## How migrations work

- The runner (`scripts/migrate.js`) executes each `.sql` file in order and tracks applied migrations in a `_migrations` table.
- Once a migration is recorded as applied, it is permanently skipped on all future runs.
- Migrations are applied to both local (D1) and remote (production) databases.

## Creating a new migration

1. Create a new file with the next sequential number:
   ```
   0018_short_description.sql
   ```
2. Write your SQL. Use `ALTER TABLE` to modify existing tables, `CREATE TABLE IF NOT EXISTS` for new tables.
3. Test locally:
   ```
   npm run db:migrate:local
   ```
4. Deploy to production:
   ```
   npm run db:migrate
   ```

## Rules

- **Never edit or rename an existing migration file** — they've already run on production.
- **Never delete a migration file** — the tracking table still references it.
- **Never reorder migrations** — numbering determines execution order.
- Use `IF NOT EXISTS` for new tables/indexes to keep migrations idempotent.
- Keep each migration focused on a single change when possible.

## Current migrations

| # | File | Description |
|---|------|-------------|
| 0001 | `0001_create_event_logs.sql` | Event logs + guild settings tables |
| 0002 | `0002_create_automations.sql` | Automations + automation logs tables |
| 0003 | `0003_create_commands.sql` | Commands + command logs tables |
| 0004 | `0004_multi_trigger_automations.sql` | Add trigger_events column to automations |
| 0005 | `0005_command_permissions.sql` | Add permission columns to commands |
| 0006 | `0006_context_menu_user.sql` | Add context_menu_user to commands |
| 0007 | `0007_server_settings.sql` | Add settings columns to guild_settings |
| 0008 | `0008_webhooks.sql` | Webhooks table |
| 0009 | `0009_server_stats.sql` | Server stats table |
| 0010 | `0010_aggregated_stats.sql` | Aggregated stats, voice sessions, checkpoint tables |
| 0011 | `0011_cron_job_history.sql` | Cron job history table |
| 0012 | `0012_actor_is_bot.sql` | Add actor_is_bot to event_logs |
| 0013 | `0013_server_stats_human_count.sql` | Add human_count to server_stats |
| 0014 | `0014_member_role_cache.sql` | Guild role/member cache tables + views |
| 0015 | `0015_automation_public_ids.sql` | Add public_id to automations |
| 0016 | `0016_api_keys.sql` | API keys table |
| 0017 | `0017_command_require_voice.sql` | Add require_voice to commands |
