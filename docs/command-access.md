---
title: Command access
layout: default
---

# Who can run a command

Every command has a **Permission Level** (Everyone, Administrators, Moderators,
Server Managers, or custom permissions). Under it, in the same Permissions section
of the command's page, are **role rules**:

- **Also allow these roles** — members with any of these roles can run the command
  even without the permission level.
- **Never allow these roles** — members with any of these roles cannot run it,
  whatever else they have.

The rule, in order:

1. A server administrator can always run it.
2. A member with a denied role cannot. (A role in both lists is denied.)
3. A member with an allowed role can.
4. Otherwise the permission level decides.

So "Moderators, plus the Helper role, but never Muted" is: level Moderators, allow
Helper, deny Muted. It works on custom commands, and on built-ins like `/timebox`
and `/quorum` through their per-server permission override.

A superadmin editing a built-in command changes it for every server, so its permission level is
global. Role ids belong to one server, so the role rules on that form are saved as the open server's
own override and the page says so. A server admin's edit of a built-in saves both as their override.

## How it is enforced

One check, `memberMayUseCommand` in `src/lib/discord/command-access.ts`, runs at the
top of command dispatch in `POST /api/discord/interactions`, before anything
runs, for custom, built-in and integration commands alike. It used to run only for
custom commands, so a built-in handled early (`/quorum`, `/timebox`, `/room`) relied
on Discord's own advisory gate alone. `/help` uses the same function to list only
what a member can run.

Discord hides a command from members who lack its permission level, and an allowed
role that lacks it could not see the command. So when a command has allowed roles
and a permission level, it is **registered without the permission gate** and this
check is the only gate. Denied roles do not change registration.

## Where it is stored

`access_rules`, a JSON column on `commands` and on `built_in_command_overrides`
(migration 0073): `{"allow_roles": [...], "deny_roles": [...]}`, empty when unset.
The next rules (specific members, channels, categories, time windows) are more keys
in the same object, not more migrations.

Not yet: the command export and import files do not carry role rules, since role ids
belong to one server.

## Roles on the Settings page

Settings, Permissions, has four rows: View dashboard, View event logs, Manage automations and
Manage commands. Each has a role picker. A member who holds a picked role can open that part of
the dashboard without Manage Server.

- A role opens its own section and nothing else. A role on Event logs opens the logs page and
  the logs API. It does not open Automations, Commands, Settings, billing, API keys, integrations,
  import/export, the listing, topics, members or any other page. Those stay Manage Server.
- Any role opens "Your access" at `/admin/<server>`: a short page that lists the sections the
  member may open. They do not see the full dashboard (stats, bot controls, every link). A role
  on View dashboard alone lands there with no sections to open.
- The server picker lists these servers next to the member's admin servers.
- Administrators, Manage Server holders, the owner and SpaceBot superadmins keep everything.
- The permission level dropdown in each row does not change who gets in. Only roles do. (Two
  live servers had levels saved that never took effect, and honoring them now would surprise
  both.)
- Roles are read from Discord with the bot token on each request and kept 30 seconds. If Discord
  cannot answer, the member gets no access. Removing a role takes effect within half a minute.
- Saving Settings keeps the role lists. Before 2026-11-19 it wiped them.

How it works: the rule is `dafny/FeatureAccess.dfy`, proved and compiled to
`src/lib/server/generated/feature-access-core.js` (`bun run dafny:build`, needs `dafny` 4.11).
`src/lib/server/feature-access.ts` reads the member, their roles and the saved rules and asks it.
Form actions are guarded centrally in `src/lib/server/action-guard.ts` (only the logs, automations
and commands sections accept a role). Pages and APIs call `mayUseFeature` or `verifyGuildFeature`.
Role-only members are never put in the layout's `adminGuilds`, which many pages read as "is an
admin"; they get a separate `memberGuilds` list, so any page not changed stays closed.
