---
title: Delete a server
layout: default
---

# Delete a server and its data

Settings → **Delete this server** opens `/admin/<server>/delete`. The owner, a full Administrator, or a SpaceBot superadmin can use it. Manage Server alone is not enough.

## What the person sees

The page lists what goes, asks them to type the server's name, and only then enables the button. A server with a running paid plan is blocked until the plan is cancelled on Billing.

## What happens

1. SpaceBot's slash commands are removed from the server on Discord.
2. Every row about the server is deleted (`SERVER_TARGETS` in `src/lib/server/server-deletion.ts`). Child tables go before their parents, so nothing is left without its parent. The person's own dashboard activity for that server's pages is deleted too.
3. SpaceBot leaves the server. This comes last, so a delete that stopped early can be finished from the dashboard.

Big tables go in slices of 5,000 rows, and one press spends at most 150 statements. A very large server may say "Still deleting"; press the button again to continue.

## What is kept

One row in `server_deletions`: server id, who did it, when, and how many rows. No names and no content.

## Tests

`src/tests/server-deletion.test.ts` runs against the real schema from every migration. If a table is renamed or a column changes, the target list fails the test. A new table that holds server data must be added to `SERVER_TARGETS`.
