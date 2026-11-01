# Command sync

Nobody has to run `register-commands`. A server's slash commands reach Discord
by themselves, and a deploy that changes a command reaches every server.

## How it works

`sync_commands` is a minute job (cron job `sync_commands`, workflow preset
`minute-command-sync`). Each run:

1. Takes up to ten servers, the ones looked at longest ago. Servers come from
   custom commands, built-in overrides, integrations and earlier syncs.
2. Rebuilds the command list each should have with `buildGuildCommandPayload`.
   That is the same builder `syncGuildCommands` sends, so the two cannot differ.
3. Hashes the list and compares it with `guild_command_sync.payload_hash`
   (migration 0074), the hash of the list last sent.
4. Syncs the server if the hash differs or was never stored. Otherwise it only
   notes the check.

A migration that changes a built-in command's options, a code change to
`toDiscordCommand`, or a role rule that moves a permission gate all change the
list, so all of them reach Discord within a few minutes of the deploy. With
more than ten servers it takes one run per ten.

A failed sync (a server the bot has left, a Discord error) is stored in
`last_error` and waits 30 minutes before the next try, so it does not fail
every minute. The error shows in `guild_command_sync`.

## The workflow operations (bug found 2026-11-01)

The dispatcher runs the preset's task node, whose `operation` must be in the
registry in `src/lib/server/superadmin-workflow-operations.ts`. Until
2026-11-01 `syncCommands` was not (nor `sweepGame`, `sweepTimebox`,
`sweepQuorum`, `listRoomsForReaping` or `reapManagedChannels`), so every run
failed with "Unknown workflow operation" and nothing synced: `/play shiritori`
(migration 0081) never reached Discord though the dashboard showed it.
`workflow-sweep-operations.test.ts` now fails if a preset names an operation the
registry does not have. A failed run shows in Superadmin → Workflows → runs.

## After a deploy

`.github/workflows/sync-commands-after-deploy.yml` runs on every push to
`main`. Pages deploys from its own Git integration, so the job waits until
`/_app/version.json` reports the pushed commit (up to 20 minutes), then runs
`sync_commands` in rounds of up to 50 servers (`POST /api/cron` with
`{"jobName":"sync_commands","limit":50}`, capped at `COMMAND_SYNC_MAX_BATCH`)
until a round changes nothing. It uses the existing secrets
`ORCHESTRATOR_SPACEBOT_API_BASE` and `CRON_SECRET`, and skips with a warning if
either is missing. The minute sweep stays the backstop.

By hand, the same thing:

```sh
SPACEBOT_API_BASE=https://<pages host> CRON_SECRET=<secret> bun run sync-commands
```

## Still immediate

Saving a command, applying an integration template and the **Sync commands
now** button on the Commands page sync that server at once. The page also shows
when the server last reached Discord and the last failed try's error, from
`guild_command_sync`. A failed button press is stored like a failed sweep, so
it also starts the 30-minute backoff. The sweep is the safety net behind them.

## /game and /play

The payload builder merges the *Space Game integration's `/game` into the
built-in `/game` and adds `/play` as an identical copy (description "Same as
/game"), in `src/lib/discord/game-command.ts`. Both are in the hashed payload,
so a change to either reaches Discord with the rest. See [game.md](game.md).

## Not covered

The global `commands` list in `src/lib/discord/commands.ts` and
`bun run register-commands` are for first setup of a new bot application and
for local development. The sweep syncs servers, not the global list. No game
command is global.
