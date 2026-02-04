# SpaceBot MCP Server

Model Context Protocol (MCP) server that provides read access to SpaceBot data including:

- **Event Logs** - Message creates, member joins, role changes, etc.
- **Automations** - Configured automation rules and their execution history
- **Commands** - Custom slash commands and their usage logs
- **Server Settings** - Guild configurations, permissions, and preferences

## Setup

### 1. Install Dependencies

```bash
cd mcp-server
npm install
```

### 2. Configure Environment Variables

The MCP server needs access to your Cloudflare account to query the D1 database:

```bash
# Required
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"

# Optional (defaults to SpaceBot's database)
export D1_DATABASE_ID="6bce735c-2dca-43cd-9911-2eef7062377a"
```

#### Getting a Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Create a new API token with **D1 Read** permissions
3. Copy the token and set it as `CLOUDFLARE_API_TOKEN`

### 3. Configure in VS Code / Cursor

Add to your MCP settings (`.vscode/mcp.json` or Cursor settings):

```json
{
  "mcpServers": {
    "spacebot": {
      "command": "node",
      "args": ["c:/Users/monag/_Projects/starspace/spacebot/mcp-server/index.js"],
      "env": {
        "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
        "CLOUDFLARE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Available Tools

### `list_guilds`
List all Discord server IDs that have data in SpaceBot.

### `get_event_logs`
Get event logs for a server with filtering options.
- `guildId` (required): Discord server ID
- `limit`: Max logs to return (default: 50)
- `offset`: Pagination offset
- `category`: Filter by category (message, member, role, etc.)
- `eventType`: Filter by specific event type

### `get_log_stats`
Get statistics about event logs for a server.
- `guildId` (required): Discord server ID

### `get_automations`
Get all automations for a server.
- `guildId` (required): Discord server ID
- `enabledOnly`: Only return enabled automations
- `limit`: Max automations to return

### `get_automation`
Get a specific automation by ID.
- `automationId` (required): Automation ID
- `guildId` (required): Discord server ID

### `get_automation_logs`
Get execution logs for automations.
- `guildId` (required): Discord server ID
- `automationId`: Filter by automation
- `limit`: Max logs to return

### `get_commands`
Get all custom commands for a server.
- `guildId` (required): Discord server ID
- `enabledOnly`: Only return enabled commands
- `registeredOnly`: Only return Discord-registered commands
- `limit`: Max commands to return

### `get_command`
Get a specific command by ID.
- `commandId` (required): Command ID
- `guildId` (required): Discord server ID

### `get_command_logs`
Get usage logs for commands.
- `guildId` (required): Discord server ID
- `commandId`: Filter by command
- `limit`: Max logs to return

### `get_server_settings`
Get server settings and configuration.
- `guildId` (required): Discord server ID

### `get_server_stats`
Get current server statistics.
- `guildId` (required): Discord server ID
- Returns: member_count, online_count, bot_count, human_count, channel_count, role_count, emoji_count, boost_count, boost_level

### `get_server_stats_history`
Get historical server statistics for graphing.
- `guildId` (required): Discord server ID
- `period`: Time period - `24h`, `7d`, `30d`, or `90d` (default: 7d)
- Returns: Array of stats snapshots with period, member_count, online_count, bot_count, human_count

### `get_member_growth`
Get member growth statistics.
- `guildId` (required): Discord server ID
- Returns: Current counts and changes over 1 day, 7 days, and 30 days (total and human-only)

### `get_aggregated_stats`
Get aggregated activity statistics.
- `guildId` (required): Discord server ID
- `period`: Time period - `24h`, `7d`, `30d`, or `90d` (default: 7d)
- `periodType`: Granularity - `hourly` or `daily` (default: daily)
- Returns: member_joins, member_leaves, voice_total_seconds, voice_unique_users, message_count, total_events per period

### `get_activity_summary`
Get a summary of server activity for the last 7 days.
- `guildId` (required): Discord server ID
- Returns: Total joins, leaves, net growth, voice hours, messages, events, peak voice users, most active hours

### `get_schema_info`
Get documentation about SpaceBot's capabilities.
- No parameters required
- Returns: Available trigger events, action types, filter types, template variables, command option types

### `search_automations`
Search for automations by name or description.
- `guildId` (required): Discord server ID
- `query` (required): Search text to match

### `search_commands`
Search for commands by name or description.
- `guildId` (required): Discord server ID
- `query` (required): Search text to match

### `get_automations_by_trigger`
Find all automations triggered by a specific event.
- `guildId` (required): Discord server ID
- `triggerEvent` (required): Event type (e.g., `MEMBER_JOIN`, `MESSAGE_CREATE`, `VOICE_JOIN`)

### `get_automations_by_action`
Find all automations that perform a specific action.
- `guildId` (required): Discord server ID
- `actionType` (required): Action type (e.g., `SEND_MESSAGE`, `ADD_ROLE`, `BAN_MEMBER`)

## Resources

The server also exposes guilds as MCP resources. Each guild is available at:
```
spacebot://guild/{guildId}
```

Reading a guild resource returns a summary of all settings, automations, commands, and log statistics.

## Development

```bash
# Run with file watching
npm run dev

# Run normally
npm start
```
