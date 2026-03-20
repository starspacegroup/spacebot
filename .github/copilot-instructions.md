# Copilot Instructions for SpaceBot

## Server Management Rules

**NEVER** attempt to start, restart, stop, or run development servers. This includes:

- `npm run dev`
- `npm start`
- `npm run dev:tunnel`
- `wrangler dev`
- `wrangler pages dev`
- Any variation of server startup commands
- Any process management commands (kill, restart, etc.)

**Always assume the server is already running.** If something appears to need a server restart, inform the user and let them handle it manually.

## Development Environment

This project uses:
- **SvelteKit** for the web framework
- **Cloudflare Workers/Pages** for deployment
- **Wrangler** for local development and deployment
- **D1** for the database

The user manages their own development servers via separate terminal instances.

## Local Development URLs

The dev server is **always** running on these URLs:

- **Local:** `http://localhost:4269`
- **Tunnel:** `https://spacebot-dev.starspace.group` (via cloudflared tunnel, always running)
- **Production Tunnel:** `https://spacebot-prod.starspace.group` (via cloudflared tunnel, for production environment)

When testing or debugging with browser dev tools, always use port **4269** for localhost. Both URLs should be tested when investigating issues.

## Code Changes

When making code changes that would typically require a server restart (e.g., environment variables, server hooks), simply note this to the user rather than attempting to restart anything.

## Database Migrations

**NEVER** modify an existing migration file. All migrations in the `migrations/` folder have already been applied to production and cannot be changed. Modifying them would cause the production database to diverge from the migration history.

To make database schema changes:

1. **Create a new migration file** with the next sequential number (e.g., `0018_description.sql`)
2. Use `ALTER TABLE` statements to modify existing tables
3. Use `CREATE TABLE IF NOT EXISTS` for new tables
4. Never use `DROP TABLE` or `DROP COLUMN` without explicit user approval
5. Run `npm run db:migrate:local` to test locally before applying to production

The migration runner (`scripts/migrate.js`) tracks applied migrations in a `_migrations` table. Once a migration has been recorded as applied, it is permanently skipped on future runs.

**Existing migrations are immutable. Always add new files instead of editing old ones.**
