# Topic

`/topic` gives a conversation starter: "Is a hotdog a sandwich?", would-you-rathers, what-ifs, food
and everyday questions. It is **off until a server turns it on** (Commands page, like `/timebox`).

```
/topic new                     a random topic, posted in the channel
/topic new kind:Food           pick the sort: debate, rather, what_if, food, life
/topic settings set_voice_status:True custom_only:True    Manage Server only
/topic add text:Is a Pop-Tart a ravioli?                  the server's own list (Manage Server)
/topic list                                               numbered, so you can remove one
/topic remove number:3
/topic set channel:#Lounge text:Movie night   set any voice channel's topic by hand (Manage Server)
/topic clear channel:#Lounge              reset it to nothing
```

## Setting or resetting a voice channel by hand

`/topic set` and `/topic clear` (Manage Server) change a voice or stage channel's status directly. The
manager does not need to be in the channel, and the `set_voice_status` option does not matter: this is
an explicit act. Leave `text` blank and `/topic set` picks a topic from the server's list; `clear`
resets the status to nothing. The channel comes from Discord's own picker, and the bot checks it is a
voice or stage channel. The reply is private.

## The server's own list

People with Manage Server can add topics (up to 200 per server, 200 characters each, stored in
`topic_custom`). Own topics join the built-in list, so they show up as often as any other. With
`custom_only` on, the server gets only its own topics; while the list is empty the built-ins are
used, so the command never goes quiet. Asking for a `kind` always draws from the built-in category.
Text is cleaned to one line with no bold markers, duplicates are refused, and the bot never pings
anyone from a topic. Topics are the server's own words: they are public in the channel, so the
people with Manage Server are responsible for what is on the list.

## Voice channel status

With `set_voice_status` on, `/topic new` used in a **voice channel's own chat** by someone who is **in
that voice channel** also sets the channel's voice status (the line under its name) to the topic.
Anywhere else, or from someone not in the channel, it only posts the topic. The option is off by
default and is stored per server in `topic_settings` (migration 0101).

How "in that channel's chat" is decided: a voice channel's chat has the same id as the channel, and
`live_voice_states` says which channel the member is in, so the check is that the two are equal.

SpaceBot needs the **Set Voice Channel Status** permission (and Connect) in that channel. If Discord
refuses, the topic still posts and a small note says the permission is missing.

## Where the topics come from

`src/lib/server/topics.ts`: a fixed list, 125 topics in five kinds. Nothing comes from a member, so
the bot never repeats text someone chose. It remembers the last topic per server and does not show
the same one twice in a row. Add topics to the list; keep them safe for any server.

Code: `src/lib/server/topic-command.ts`, wired in the interactions route. `setVoiceStatus` is in
`src/lib/discord/rest-client.ts`.

Not built: a dashboard page for the options and the list (today they are slash subcommands), a daily
topic on a schedule.
