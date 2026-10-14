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

## Still immediate

Saving a command, applying an integration template and the Register button
still sync that server at once. The sweep is the safety net behind them.

## Not covered

The global `commands` list in `src/lib/discord/commands.ts` and
`bun run register-commands` are for first setup of a new bot application and
for local development. The sweep syncs servers, not the global list.
