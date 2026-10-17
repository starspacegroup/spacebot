# Member content

`/about` lets chosen members keep one short piece of content about themselves.
The bot serves it back, and so does one read-only API route.

```
/about role role:@Reviewer     choose who may write (Manage Server)
/about set text:...            set your own content (up to 500 characters)
/about clear                   remove it
/about show [member]           read a member's content (yours if blank)
```

## Who may write

One role per server, chosen with `/about role`. Until it is set, nobody may
write. The role is checked on every `set` and `clear` from the roles Discord
sends with the command, so taking the role away ends write access on the
member's next command. A member can only ever change their own row. Reading is
open to everyone. Replies never ping (`allowed_mentions: { parse: [] }`).

## API

`GET /api/v1/member-content` requires `content:read`.

| Parameter         |                                          |
| ----------------- | ---------------------------------------- |
| `user_id`         | One member; 404 if they have set nothing |
| `limit`, `offset` | Paging, `limit` 1–100 (default 100)      |

Content is plain text as typed. A caller that renders it as HTML must escape it.

## Storage

Migration `0078_member_content.sql`: `member_content` (one row per guild and
member), `member_content_settings` (the role), and the built-in command. Like
`/oldest` it is handled directly by the interactions route and is not in
`ALWAYS_ENABLED_BUILT_INS`.

Not built (issue #69 beyond this slice): collections, several entries per
member, a web editor, review before publish, the keyless public API, and
autocomplete.
