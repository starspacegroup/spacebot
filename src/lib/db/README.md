# Event Logging System

This module provides comprehensive Discord event logging for the SpaceBot
dashboard.

## Features

- **Real-time Event Capture**: Logs all Discord events including:
  - Member joins/leaves
  - Message creation/editing/deletion
  - Voice channel activity (join, leave, mute, deafen, streaming)
  - Channel/role management
  - Moderation actions (bans, kicks, timeouts)
  - Emoji/sticker changes
  - Thread activity
  - Reactions
  - Slash command usage

- **Cloudflare D1 Database**: Scalable, edge-optimized storage
- **Admin Dashboard**: Beautiful logs viewer at `/admin/[server-id]/logs`
- **Filtering & Search**: Filter by category, event type, user, date range
- **Auto-refresh**: Real-time updates every 10 seconds

## Setup

### 1. Create the D1 Database

```bash
# Create the database
bun run db:create

# Copy the database_id from the output and add it to wrangler.toml
```

Update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "spacebot-logs"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 2. Run Migrations

```bash
# For local development
bun run db:migrate:local

# For production
bun run db:migrate
```

### 3. Enable Gateway Intents

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Go to your application → Bot
2. Enable these **Privileged Gateway Intents**:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent

### 4. Start the Gateway Bot

The gateway bot runs as a separate process to capture Discord events:

```bash
# Set your bot token
$env:DISCORD_BOT_TOKEN = "your_bot_token"

# Start the gateway bot
bun run dev:gateway
```

### 5. Run the Web App

In a separate terminal:

```bash
bun run dev
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Discord API    │────▶│  Gateway Bot     │────▶│  D1 Database    │
│  (WebSocket)    │     │  (discord.js)    │     │  (event_logs)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │
                        │  SvelteKit App   │◀─────────────┘
                        │  /admin/.../logs │
                        └──────────────────┘
```

## Event Categories

| Category       | Events                                                    |
| -------------- | --------------------------------------------------------- |
| 👤 Member      | Join, Leave, Update                                       |
| 💬 Message     | Create, Edit, Delete, Bulk Delete                         |
| 🎤 Voice       | Join, Leave, Move, Mute, Deafen, Stream, Video            |
| 📁 Channel     | Create, Delete, Update, Pins                              |
| 🏷️ Role        | Create, Delete, Update, Add to Member, Remove from Member |
| ⚙️ Server      | Settings Update                                           |
| 😀 Emoji       | Create, Delete, Update (+ Stickers)                       |
| 🔗 Invite      | Create, Delete                                            |
| 🔨 Moderation  | Ban, Unban, Kick, Timeout                                 |
| ⚡ Interaction | Commands, Buttons, Modals                                 |
| 🧵 Thread      | Create, Delete, Update, Member Join/Leave                 |
| ❤️ Reaction    | Add, Remove, Remove All                                   |

## API Endpoints

### GET `/api/logs/[guildId]`

Fetch logs for a guild. Requires admin permissions.

Query parameters:

- `limit` (number): Max results (default: 50, max: 100)
- `offset` (number): Pagination offset
- `category` (string): Filter by event category
- `eventType` (string): Filter by specific event type
- `actorId` (string): Filter by user ID
- `startDate` (string): Filter by start date
- `endDate` (string): Filter by end date
- `search` (string): Search in names
- `stats` (boolean): Include statistics

### POST `/api/logs/create`

Internal endpoint for the gateway bot to log events. Requires bot token
authentication.

## Database Schema

```sql
-- Event logs table
CREATE TABLE event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    target_id TEXT,
    target_name TEXT,
    channel_id TEXT,
    channel_name TEXT,
    details TEXT,  -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Guild settings
CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY,
    logging_enabled INTEGER DEFAULT 1,
    log_channel_id TEXT,
    excluded_channels TEXT,  -- JSON array
    excluded_categories TEXT,  -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Production Deployment

For production, the gateway bot should be deployed separately (e.g., on a VPS,
Railway, or Fly.io) since Cloudflare Pages/Workers don't support persistent
WebSocket connections.

Recommended setup:

1. Deploy SvelteKit app to Cloudflare Pages
2. Deploy gateway bot to a long-running server (Railway, Fly.io, VPS)
3. Both use the same D1 database via the REST API

## Stats Aggregation

The system includes a smart stats aggregation cron job that runs hourly to build
aggregated statistics from event logs. This enables efficient querying for:

- **Member Growth**: Joins, leaves, and net change over time
- **Voice Activity**: Total time (minutes/hours/days), unique users, peak concurrent users
- **Message Activity**: Message counts and unique authors
- **Trend Analysis**: Daily and weekly comparisons

### How It Works

1. **Hourly Cron** (`0 * * * *`): Aggregates raw events into hourly buckets
2. **Daily Cron** (`0 0 * * *`): Rolls up hourly data into daily summaries, refreshes stats from Discord API, and cleans up old data

### Smart Processing

The aggregation is designed to be efficient and idempotent:

- **Checkpoint Tracking**: Remembers the last processed event ID per guild
- **Skip Existing Data**: Never reprocesses periods that already have aggregated stats
- **Incremental Updates**: Only processes new events since last run
- **Voice Session Tracking**: Pairs VOICE_JOIN/VOICE_LEAVE events to calculate accurate session durations

### Database Tables

```sql
-- Aggregated statistics (hourly/daily)
CREATE TABLE aggregated_stats (
    guild_id TEXT NOT NULL,
    period_type TEXT NOT NULL,  -- 'hourly', 'daily'
    period_start DATETIME NOT NULL,
    period_end DATETIME NOT NULL,
    member_joins INTEGER DEFAULT 0,
    member_leaves INTEGER DEFAULT 0,
    member_net_change INTEGER DEFAULT 0,
    voice_total_seconds INTEGER DEFAULT 0,
    voice_unique_users INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    ...
);

-- Voice session tracking
CREATE TABLE voice_sessions (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    joined_at DATETIME NOT NULL,
    left_at DATETIME,  -- NULL if still in channel
    duration_seconds INTEGER,  -- Computed on leave
    ...
);
```

### API Endpoints

- `POST /api/stats/aggregate` - Trigger stats aggregation (requires CRON_SECRET)
- `GET /api/stats/aggregate` - View aggregation status and info

### Querying Aggregated Stats

```javascript
import { getAggregatedStats, getVoiceActivitySummary, getMemberGrowthSummary } from '$lib/db/stats-aggregation.js';

// Get voice activity for last 7 days
const voiceStats = await getVoiceActivitySummary(db, guildId, '7d');
// Returns: { totalSeconds, totalMinutes, totalHours, uniqueUsers, sessionCount, avgSessionMinutes }

// Get member growth for last 30 days
const memberStats = await getMemberGrowthSummary(db, guildId, '30d');
// Returns: { joins, leaves, netChange, dailyAverage }

// Get raw aggregated data for charts
const data = await getAggregatedStats(db, guildId, {
  periodType: 'daily',
  startDate: '2026-01-01',
  endDate: '2026-02-01'
});
```

