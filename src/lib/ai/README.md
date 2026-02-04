# AI Chat Module with MCP Tools

This module integrates with Cloudflare Workers AI to provide LLM-based chat functionality for bot managers via DMs. It also includes MCP (Model Context Protocol) tool support for querying SpaceBot data.

## Features

- **AI Chat via DMs**: Server managers can chat with SpaceBot in DMs
- **MCP Tool Integration**: AI can query event logs, automations, commands, and settings
- **Multi-Guild Support**: Works across all servers where the user is a manager
- **Server Selection**: Users can select which server to operate on when managing multiple servers

## Server Selection

When a user manages multiple servers, they can select which server to work with:

### Commands
- `list servers` / `show servers` / `my servers` - List all managed servers
- `switch to <server name>` - Select a server by name
- `select <server name>` - Select a server by name
- `use server <server name>` - Select a server by name
- `set server to <server name>` - Select a server by name

### Behavior
- If a user only manages one server, it's automatically selected
- Server selection persists for 24 hours of inactivity
- The AI will use the selected server's ID for all tool calls
- If no server is selected and multiple are available, the AI will prompt the user to select one

### Example
```
User: list servers
SpaceBot: 
**Your Servers:**

• **My Gaming Server**
   Members: 150 | Channels: 25
• **Coding Community**
   Members: 500 | Channels: 40

**To select a server:**
• `switch to <server name>`
• `select <server name>`
• `use server <server name>`

User: switch to gaming
SpaceBot: ✅ Switched to **My Gaming Server**. I'll now answer questions about this server.

User: how many events today?
SpaceBot: [Uses get_log_stats with the selected server's ID]
```

## Setup

### 1. Get Cloudflare Credentials

1. Log into the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **AI** > **Workers AI**
3. Click **Use REST API**
4. Create a Workers AI API Token with read/edit permissions
5. Copy your Account ID

### 2. (Optional) Set Up AI Gateway

For analytics, caching, and rate limiting:

1. Navigate to **AI** > **AI Gateway**
2. Create a new gateway
3. Copy the gateway name/ID

### 3. Configure Environment Variables

Add to your `.env` file (for local development with the gateway):

```bash
# Required for AI Chat
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_AI_TOKEN=your_api_token

# Required for MCP Tools (D1 database access)
CLOUDFLARE_API_TOKEN=your_d1_api_token

# Optional
CLOUDFLARE_AI_GATEWAY_ID=your_gateway_id
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
D1_DATABASE_ID=your_database_id
```

For production, set these in the Cloudflare dashboard or via `wrangler secret`.

## How It Works

### DM Flow

1. When someone sends a DM to the bot, the gateway checks if they are a manager
2. A "manager" is anyone with **Manage Server** or **Administrator** permissions in any guild where the bot is installed
3. If they are a manager, the AI receives context about their managed servers
4. The AI can use MCP tools to query data from those servers
5. The AI responds with helpful information

### MCP Tools

When properly configured, the AI has access to these tools:

| Tool | Description |
|------|-------------|
| `list_guilds` | List all server IDs with SpaceBot data |
| `get_event_logs` | Get event logs (messages, joins, etc.) |
| `get_log_stats` | Get log statistics by category |
| `get_automations` | Get configured automations |
| `get_automation` | Get a specific automation |
| `get_automation_logs` | Get automation execution history |
| `get_commands` | Get custom slash commands |
| `get_command` | Get a specific command |
| `get_command_logs` | Get command usage history |
| `get_server_settings` | Get server configuration |

### Example Conversations

**User**: "How many events have been logged in my server today?"
**SpaceBot**: Uses `get_log_stats` to fetch statistics and summarizes them.

**User**: "What automations do I have set up?"
**SpaceBot**: Uses `get_automations` to list configured automations.

**User**: "Show me the last 5 member join events"
**SpaceBot**: Uses `get_event_logs` with category filter to fetch and display joins.

## Free Models

Cloudflare offers generous free tiers for Workers AI. The default model is:

- `@cf/meta/llama-3.1-8b-instruct-fast` - Fast, free, good for chat

Other free options:
- `@cf/meta/llama-3.2-1b-instruct` - Smaller, faster
- `@cf/meta/llama-3.2-3b-instruct` - Balance of speed and quality
- `@cf/meta/llama-3.1-8b-instruct` - Higher quality, slightly slower

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Discord User   │───▶│  Gateway Bot    │───▶│  AI Chat Module │
│  (DM Message)   │    │  (gateway.js)   │    │  (chat.js)      │
└─────────────────┘    └─────────────────┘    └────────┬────────┘
                                                       │
                       ┌─────────────────┐    ┌────────▼────────┐
                       │  Cloudflare D1  │◀───│  MCP Client     │
                       │  (Database)     │    │  (mcp-client.js)│
                       └─────────────────┘    └────────┬────────┘
                                                       │
                       ┌─────────────────┐    ┌────────▼────────┐
                       │  Response       │◀───│  Workers AI     │
                       │  (to Discord)   │    │  (LLM)          │
                       └─────────────────┘    └─────────────────┘
```

## Files

- `chat.js` - Main AI chat module with tool calling support
- `mcp-client.js` - MCP client for querying D1 database

## Customization

Edit `src/lib/ai/chat.js` to:
- Modify the `BASE_SYSTEM_PROMPT` for different bot personality
- Change `DEFAULT_MODEL` for different LLM
- Add conversation history for multi-turn chats
- Add new MCP tools

Edit `src/lib/ai/mcp-client.js` to:
- Add new database queries
- Add write operations (create automations, etc.)
- Add Discord API integrations
