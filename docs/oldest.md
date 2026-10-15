# Oldest

`/oldest` answers "who has been on Discord the longest?" with a top ten.

```
/oldest                                 oldest accounts (default)
/oldest show:Newest accounts            youngest accounts
/oldest show:Longest in this server     longest-serving members, by join date
```

The reply is public. Mentions are shown but nobody is pinged.

## How it works

A Discord user id is a snowflake: the top 42 bits are the creation time. So
account age needs no API call. `src/lib/server/oldest.ts` reads
`guild_members_cache` (migration 0014), which the scheduled workflows already
refresh, and turns ids into dates with `(id >> 22) + 1420070400000`.

Server tenure uses the cached `joined_at` instead.

## Things that matter

- **Order by number, never by text.** `user_id` is TEXT and ids grew from 17 to
  19 digits, so a text sort puts the newest accounts first. Every query orders by
  `CAST(user_id AS INTEGER)`. `src/tests/oldest.test.ts` uses ids of three
  lengths so a regression fails.
- **Bots are left out.** Some bot accounts are very old.
- **The list is as old as the cache.** The reply says how old. A member who left
  may still show, and one who joined since may be missing.
- **Empty is two different states.** A server never synced says so (the fix is a
  dashboard visit). A server with a past sync but no rows is mid-refresh, because
  the refresh deletes the guild's rows before it inserts them; the reply says to
  try again.

## Setup

Migration `0075_oldest_command.sql` adds the built-in. It is not in
`ALWAYS_ENABLED_BUILT_INS`, so a server can turn it off or gate it under
Commands like any other built-in.

Not built: the caller's own rank ("you are #47"), and account age on a profile
view.
