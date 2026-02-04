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
