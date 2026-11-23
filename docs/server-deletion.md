---
title: Delete a server
layout: default
---

# Delete a server and its data

Settings → **Delete this server** opens `/admin/<server>/delete`. The owner, a full Administrator, or a SpaceBot superadmin can use it. Manage Server alone is not enough.

## What the person sees

It takes two steps, so it cannot happen by accident.

1. They read the list, can follow a link to download a backup first, type the server's name exactly, and tick "I understand this cannot be undone". Nothing is deleted yet.
2. A "Last step" screen has a button that stays off for 10 seconds. The server checks the wait too: step one gives a one-use token tied to that person and that server, and the delete runs only if the token is 10 seconds to 10 minutes old. A new request replaces the old token. Cancel goes back to step one.

Guards: only the owner, a full Administrator or a superadmin; a running paid plan blocks it, and so does a plan that cannot be read (fail closed); the check is repeated in both steps. Tokens live in `server_deletion_requests` (migration 0106).

## What happens

1. SpaceBot's slash commands are removed from the server on Discord.
2. Every row about the server is deleted (`SERVER_TARGETS` in `src/lib/server/server-deletion.ts`). Child tables go before their parents, so nothing is left without its parent. The person's own dashboard activity for that server's pages is deleted too.
3. SpaceBot leaves the server. This comes last, so a delete that stopped early can be finished from the dashboard.

Big tables go in slices of 5,000 rows, and one press spends at most 150 statements. A very large server may say "Still deleting"; press the button again to continue.

## What is kept

One row in `server_deletions`: server id, who did it, when, and how many rows. No names and no content.

## Tests

`src/tests/server-deletion.test.ts` runs against the real schema from every migration. If a table is renamed or a column changes, the target list fails the test. A new table that holds server data must be added to `SERVER_TARGETS`.
