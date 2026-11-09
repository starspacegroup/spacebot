# Statistics

`/admin/{serverId}/stats` is one page with five tabs, switched client-side. The tab is
in the address bar (`?tab=overview|voice|text|activity|automations`), so a link opens where it
was copied. The range pills (`?period=`) apply to every tab and keep the tab you are on.

| Tab         | What it shows                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Overview    | Members, automations, commands and events at a glance; member count and growth; roles and boosts           |
| Voice       | Who is in voice right now, voice trends, the leaders, and the searchable voice activity log                |
| Text        | Who starts conversations, who starts big ones, who ends up killing them, and how each text channel is used |
| Activity    | Events by category, the daily activity chart, the day-and-hour heatmap, the most active channels, boosters |
| Automations | Command usage, automation performance, and the latest automation runs                                      |

"Include bots" in the header switches every chart and total on the page at once. Each
card also has its own bot switch.

## Voice

The Voice tab used to be its own page, `/stats/vc-activity`. That URL now redirects (301)
to `/stats?tab=voice`, keeping any query string, so old links and filtered views still
work.

`VoiceLive.svelte` loads its own data, so the other tabs pay nothing for it:

- The live board comes from `/api/admin/{id}/live-voice` and the live-updates stream
  (`voice_snapshot`), with a 15-second poll as the fallback while the tab is visible.
- The log comes from `/api/admin/{id}/voice-activity-log`. Its filters (`search`,
  `eventType`, `sort`, `startDate`, `endDate`, `page`, `pageSize`) are read from the
  address bar on load and written back as you change them. Leaving the Voice tab drops
  them from the address.
- Only what is on is shown for each member (camera, sharing, muted, deafened), not a row
  of "off" chips.
- **Voice members** (`VoiceMembers.svelte`) lists everyone who spent time in voice in the
  chosen range, most time first: face, name, time, and when they were last there. It reads
  `/api/admin/{id}/voice-members?period=` (same access rule as the other admin APIs, up to
  500 people), hides bots unless you tick Bots, and has a name search. The leaders cards
  below show only the top five.

## Who starts chats, who starts big ones, who kills them

The Voice tab (below the member list) and the Text tab each show three short boards, so a
server owner can see who gets a room going, who gets it big, and who ends up emptying it.
They are worked out from data the bot already records, on request, so they cover history
and add no storage: voice from `voice_sessions`, text from the `MESSAGE_CREATE` events (kept
90 days). Bots are left out everywhere, as the person and as the other people. The code is
`voice-presence.ts` and `text-conversations.ts` (pure analysis functions, tested in
`conversations.test.ts`); the APIs are `/api/admin/{id}/voice-presence` and
`/api/admin/{id}/text-conversations`, with the same access rule as the other admin stats.

**Voice**

- _Starts chats_: joined a channel with no other person in it. Shows how many of those
  starts got company.
- _Starts big chats_: a start that reached **4 people together at once**, the starter
  included, while the starter was still there. It is a true "at the same time" count: people
  dropping in one after another do not add up.
- _Kills chats_: joined a channel that had **at least two other people** in it, and they all
  left within **2 minutes**. Joins where only some left are counted as "other joins" under
  the name. Often a coincidence once; look for the same name again and again.
- A session still open after 12 hours is taken as a missed leave. A session made by the
  repair pass has no join event, so it counts as a person and shows an unknown name until one
  is found.

**Text**

- A _conversation_ is a run of messages with no gap longer than **10 minutes** in one channel.
- _Starts conversations_: wrote the first message after a 10-minute quiet. Shows how many were
  answered by someone else.
- _Starts big conversations_: a start that reached **4 different people**. A long monologue is
  not big.
- _Kills conversations_: the last message of a lively conversation (at least two other people
  and five messages from others before it) is theirs. Silence after a message is often just
  the end of the topic, so the board shows a count and a share of the lively chats they joined,
  never a verdict.
- The Channels table gives each channel's messages, conversations, big ones and average people
  per conversation.
- A busy server is read from its newest 30,000 messages in the range; the tab says so when it
  cut the older part. A channel excluded from logging has no events and shows nothing.

## Long ranges (60d, 90d)

Hourly aggregates are pruned after 30 days; the daily rollups are kept. The voice and
message charts and the voice and member summaries read hourly rows for the last 28 days
and daily rows before that (`rollupRows` in `stats-aggregation.ts`), so a 90d view is not
empty past a month. Days from the daily rollups are labelled by UTC day, not the
server's time zone, because a daily row covers a whole UTC day.

## Preview data (dev only)

`?preview=1` fills every tab with canned data from `src/lib/stats/preview-fixture.ts`,
so the page can be looked at without a populated server. It is loaded behind
`import.meta.env.DEV` and is not in a production build.

## When the database is overloaded (2026-11-05)

D1 refuses queries with error 7429 ("overloaded, too many resources consumed within a 10 second
window") when a request reads too many rows too fast. Each stats query catches its own error and
returns an empty value, so an overloaded page used to show zeros that looked real, and the page
cached them. Two things now prevent that:

- The event counts (totals, today, week, month, bot and non-bot, categories, top types) come from
  **one** grouped query, `getEventStatistics`, instead of ten. Five of the ten each read every
  event the server had ever logged. The numbers are unchanged.
- If the main statistics query fails, the loader does not cache the result and the endpoint answers 502. The page then shows a "could not be loaded" notice with a Try again button.

Other queries on the page (top users, top channels, the heatmap) still scan a server's events and
are the next place to look if overload comes back.
