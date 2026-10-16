# Voice channel threshold trigger

The **Voice channel reached a head-count** trigger (`VOICE_CHANNEL_THRESHOLD`)
fires once when a voice channel's member count first reaches N. Example: "when
4 people are in General Voice, post _the gang's all here_ in #general".

It is edge-triggered. A `VOICE_JOIN` automation with a channel filter fires on
every join. This trigger fires only on the join (or move) that carries the
count from below N to N or more, then stays quiet.

```yaml
trigger: VOICE_CHANNEL_THRESHOLD
filters:
    channel_id: '123' # optional; leave unset to watch every voice channel
    min_users: 4 # required: fire when the count reaches this
    rearm_below: 3 # optional, default min_users - 1
    cooldown_minutes: 30 # optional, default 30
    count_bots: 'no' # optional, 'no' (default) or 'yes'
```

## Rules

- **Armed, fired, disarmed.** An automation starts armed for each channel. The
  crossing fires it and disarms it. More joins do nothing.
- **Re-arming needs both guards.** The channel must drop under `rearm_below`,
  and `cooldown_minutes` must have passed since the last fire. A crossing that
  happens while the cooldown still runs is spent. It is not saved for later.
- **`rearm_below`** cannot be higher than `min_users`. With the defaults
  (`min_users: 4`), the channel must fall to 2 or fewer before it re-arms.
- **Bots** do not count unless `count_bots` is `yes`.
- **Each channel has its own state.** With no channel filter, one automation
  watches every voice channel and tracks each one apart. The channel filters
  (`channel_id`, `not_channel_id`) pick which channels it watches.
- **A full room never fires.** Without a crossing there is no fire, so saving
  an automation while the room is already full, or restarting the gateway,
  stays quiet.
- **Restarts.** The arm state is in D1 (`automation_trigger_state`, migration
  0077). A gateway restart does not re-arm anything.
- Other filters, such as time windows, still apply. Arm state moves even when
  they reject the event, so the crossing is spent either way.

Template variables: `{channel.name}` and `{channel.mention}` name the channel.
`{details.humanCount}` and `{details.totalCount}` give the count at the
crossing.

## Where it runs

The gateway sends a `VOICE_CHANNEL_THRESHOLD` event, with the head-counts
before and after, whenever someone joins, leaves or moves between voice
channels. It is not written to the event log. The
`/api/automations/:guildId/process` endpoint does the edge check
(`src/lib/automation/voice-threshold.ts`) and saves the state
(`src/lib/db/automation-trigger-state.ts`).

Not in this version: a `sustained_seconds` option (count only if the head-count
holds) and a falling-edge "channel emptied" trigger.
