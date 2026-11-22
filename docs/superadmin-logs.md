---
title: Superadmin logs and relations
layout: default
---

# Superadmin: users, servers and logs

Three things a superadmin can do beyond the lists of users and servers.

## Who is in which server

A person's servers are saved when they open the dashboard. The layout already loads their
Discord guild list; for each server the bot is in, it keeps one row in `user_guilds`
(migration 0104): the person, the server, and a standing from Discord's own flags: **owner**,
**Administrator**, **Manage Server** or **member**. It is refreshed at most once an hour per
person, a server they left is dropped, and an empty answer from Discord never wipes what is
known. Servers the bot is not in are not kept.

- `/admin/superadmin/users/<id>`: the person, their servers with their standing in each, errors
  and a timeline.
- `/admin/superadmin/servers/<id>`: the server, its owner (from Discord, even if they never
  signed in), everyone recorded there, command sync state, errors, activity and changes.

Rows appear as people sign in, so a server fills up over a few days. The standing rule is
`standingOf` in `src/lib/server/user-guilds.ts`.

## Logs

`/admin/superadmin/logs`, filterable by server, person and time (up to 30 days), 50 rows a page:

| Tab         | Shows                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Audit trail | Every write a signed-in person made: who, when, which route (and form action), and the result. |
| Activity    | Commands run and events recorded, from every server.                                           |
| Errors      | Failed commands and automations, failed command syncs, bot errors, requests that failed (5xx). |

The queries live in `src/lib/server/superadmin-logs.ts`. Every value is validated and bound,
never spliced into SQL; a bad filter is dropped. The audit trail reads `user_activity_logs`, so
it covers what that table records (dashboard and API requests), not what a person typed.
IP addresses and browser strings are stored there but never shown on these pages.

How far back a tab can look is limited by how long each table keeps rows
([data retention](data-retention.md)).
