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
