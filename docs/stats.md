# Statistics

`/admin/{serverId}/stats` is one page with four tabs, switched client-side. The tab is
in the address bar (`?tab=overview|voice|activity|automations`), so a link opens where it
was copied. The range pills (`?period=`) apply to every tab and keep the tab you are on.

| Tab         | What it shows                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Overview    | Members, automations, commands and events at a glance; member count and growth; roles and boosts           |
| Voice       | Who is in voice right now, voice trends, the leaders, and the searchable voice activity log                |
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
