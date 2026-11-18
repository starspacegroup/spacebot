# Topic

`/topic` gives a conversation starter: "Is a hotdog a sandwich?", would-you-rathers, what-ifs, food
and everyday questions. It is **off until a server turns it on** (Commands page, like `/timebox`).

```
/topic new                     a random topic, posted in the channel
/topic new kind:Food           pick the sort: debate, rather, what_if, food, life
/topic settings set_voice_status:True    Manage Server only
```

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

Not built: a dashboard toggle for the option (today it is the slash subcommand), custom topic lists
per server, a daily topic on a schedule.
