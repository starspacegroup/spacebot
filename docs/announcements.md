# Announcement channel

A server picks one channel where SpaceBot posts about **global changes and other important
alerts**: Settings → Announcements → Announcement channel. It is saved with the rest of the page
(it autosaves on change) and shows the same channel list as the logging channel. Saving the
Settings page needs Administrator, like the rest of that page.

- **Nothing is set, nothing is posted.** SpaceBot never falls back to another channel, so an alert
  never lands somewhere the server did not choose.
- The channel is stored in `guild_settings.announcement_channel_id` (migration `0089`) and written
  by its own query, not by `saveGuildSettings`, so the bulk settings save cannot clear it. A form
  that does not send the field leaves it alone.
- Only text and announcement channels are accepted, checked against the synced channel list when
  the channel is known there.
- `src/lib/server/announcements.ts` has the helpers: `getAnnouncementChannel`,
  `setAnnouncementChannel` and `postAnnouncement(db, discord, guildId, text)`. A post turns
  mentions off, so an alert pings nobody, and a failed post is reported, not thrown.

Nothing posts to it yet. Whoever sends the first announcement (a release note, an outage notice)
calls `postAnnouncement` for each server.
