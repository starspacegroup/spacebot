---
title: SpaceBot Integration Protocol
layout: default
---

# SpaceBot Integration Protocol

This guide explains how external projects can integrate with SpaceBot to provide Discord slash commands, receive lifecycle events, and maintain a live connection.

## Overview

SpaceBot integrations allow external projects (like \*Space Game) to:

1. **Declare commands** — Tell SpaceBot what slash commands your project provides
2. **Handle commands** — Receive command invocations via webhook and respond to users
3. **Report status** — Send heartbeats so SpaceBot knows your service is online
4. **Sync dynamically** — Push manifest updates to add/remove/change commands without redeploying SpaceBot

## How It Works

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│              │  sync   │              │ register │              │
│  Your        │ ──────► │   SpaceBot   │ ──────►  │   Discord    │
│  Project     │         │              │          │   API        │
│              │ ◄────── │              │ ◄──────  │              │
│              │ command │              │ interact │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

1. Your project sends its **manifest** to SpaceBot's sync API
2. SpaceBot registers the commands with Discord for every guild that enabled your integration
3. When a user runs one of your commands in Discord, SpaceBot proxies the interaction to your **command handler webhook**
4. Your project processes the command and returns a response, which SpaceBot relays back to Discord

## Getting Started

### 1. Get an Integration Token

An integration token is created by a SpaceBot admin when your integration is registered. The token format is:

```
sbi_<your-slug>_<random>
```

This token authenticates your project when communicating with SpaceBot. Keep it secret — treat it like an API key.

### 2. Create Your Manifest

Your manifest is a JSON object that describes your integration and its commands. Here's a complete example:

```json
{
	"name": "My Awesome Game",
	"slug": "my-awesome-game",
	"version": "1.0.0",
	"description": "Adds game commands to your Discord server",
	"author": "Your Name",
	"author_url": "https://your-site.com",
	"icon": "🎮",
	"category": "gaming",
	"homepage": "https://your-game.com",
	"health_endpoint": "https://your-game.com/api/spacebot/health",

	"commands": [
		{
			"name": "game",
			"description": "Game commands",
			"type": 1,
			"options": [
				{
					"name": "stats",
					"description": "View your game stats",
					"type": 1,
					"options": [
						{
							"name": "player",
							"description": "Player to look up (defaults to yourself)",
							"type": 6,
							"required": false
						}
					]
				},
				{
					"name": "leaderboard",
					"description": "View the server leaderboard",
					"type": 1
				}
			]
		}
	],

	"webhooks": {
		"on_enable": "https://your-game.com/api/spacebot/on-enable",
		"on_disable": "https://your-game.com/api/spacebot/on-disable",
		"command_handler": "https://your-game.com/api/spacebot/command"
	},

	"config_schema": [
		{
			"key": "api_key",
			"label": "Game API Key",
			"type": "string",
			"required": false
		},
		{
			"key": "game_channel",
			"label": "Game Channel",
			"type": "channel",
			"required": false
		}
	]
}
```

### 3. Host the Manifest (Optional)

You can host your manifest as a static JSON file at a public URL:

```
https://your-game.com/spacebot-integration.json
```

SpaceBot can fetch this URL to discover your integration. This is useful for initial registration but the Sync API (below) is the primary way to keep your manifest up to date.

## API Reference

All API endpoints are at `https://spacebot.starspace.group/api/v1/integrations/`.

For local development, use `http://localhost:4269/api/v1/integrations/`.

### Authentication

All authenticated endpoints use Bearer token auth:

```
Authorization: Bearer sbi_your-slug_yourtoken123...
```

---

### POST `/api/v1/integrations/sync`

Push your manifest to SpaceBot. This updates your integration's commands and metadata, then re-syncs Discord commands for all guilds that have your integration enabled.

**Call this whenever your commands change** — for example, during deployment or when you add new features.

**Request:**

```http
POST /api/v1/integrations/sync
Authorization: Bearer sbi_your-slug_yourtoken123...
Content-Type: application/json

{
  "name": "My Awesome Game",
  "slug": "my-awesome-game",
  "version": "1.1.0",
  "description": "Adds game commands to your Discord server",
  "commands": [ ... ],
  "webhooks": {
    "command_handler": "https://your-game.com/api/spacebot/command"
  }
}
```

**Response:**

```json
{
	"success": true,
	"integration": "my-awesome-game",
	"guilds_synced": 3,
	"sync_results": [
		{ "guild_id": "123456789", "success": true, "registered": 5 },
		{ "guild_id": "987654321", "success": true, "registered": 5 }
	]
}
```

**Important:** The `slug` in your manifest body must match the slug of the authenticated integration token. You cannot update another integration's manifest.

---

### POST `/api/v1/integrations/heartbeat`

Tell SpaceBot your service is online. Send this every **2-3 minutes**. Integrations that miss heartbeats for 5 minutes are automatically marked as offline.

**Request:**

```http
POST /api/v1/integrations/heartbeat
Authorization: Bearer sbi_your-slug_yourtoken123...
Content-Type: application/json

{
  "version": "1.1.0",
  "uptime": 7200
}
```

The JSON body is optional — a heartbeat with no body is valid.

**Response:**

```json
{
	"success": true,
	"integration": "my-awesome-game",
	"recorded_at": "2026-02-21T12:00:00.000Z",
	"next_expected_before": "2026-02-21T12:05:00.000Z"
}
```

---

### GET `/api/v1/integrations/status`

Check the status of integrations. **No authentication required.**

**Query Parameters:**

- `slug` (optional) — Filter to a specific integration

**Request:**

```http
GET /api/v1/integrations/status?slug=my-awesome-game
```

**Response (single):**

```json
{
	"slug": "my-awesome-game",
	"name": "My Awesome Game",
	"version": "1.1.0",
	"status": "online",
	"last_heartbeat_at": "2026-02-21T12:00:00.000Z",
	"category": "gaming",
	"is_official": false,
	"commands": 1
}
```

**Response (all):**

```json
{
	"integrations": [
		{
			"slug": "starspace-game",
			"name": "*Space Game",
			"version": "1.0.0",
			"status": "online",
			"last_heartbeat_at": "2026-02-21T12:00:00.000Z",
			"category": "gaming",
			"is_official": true,
			"commands": 1
		}
	]
}
```

Status values: `online`, `offline`, `unknown`

---

## Command Handler Webhook

When a user runs one of your integration's slash commands, SpaceBot will `POST` to your `webhooks.command_handler` URL with the following payload:

### Request from SpaceBot

```http
POST https://your-game.com/api/spacebot/command
Content-Type: application/json
X-SpaceBot-Integration: my-awesome-game
X-SpaceBot-Guild: 123456789012345678
```

```json
{
	"type": "command",
	"command": "game",
	"options": [
		{
			"name": "stats",
			"type": 1,
			"options": [
				{
					"name": "player",
					"type": 6,
					"value": "234567890123456789"
				}
			]
		}
	],
	"guild_id": "123456789012345678",
	"user": {
		"id": "234567890123456789",
		"username": "player1",
		"discriminator": "0",
		"avatar": "abc123..."
	},
	"channel_id": "345678901234567890",
	"integration_slug": "my-awesome-game"
}
```

### Your Response

You can respond in two ways:

#### Option A: Simple response (recommended)

Return a plain object with `content` and/or `embeds`:

```json
{
	"content": "🏆 **player1's Stats**\nScore: 1,500 | Wins: 12 | Rank: #3",
	"ephemeral": false
}
```

Or with an embed:

```json
{
	"content": "",
	"embeds": [
		{
			"title": "🏆 player1's Stats",
			"color": 5793266,
			"fields": [
				{ "name": "Score", "value": "1,500", "inline": true },
				{ "name": "Wins", "value": "12", "inline": true },
				{ "name": "Rank", "value": "#3", "inline": true }
			]
		}
	]
}
```

#### Option B: Full Discord interaction response

Return a complete Discord interaction response object for full control:

```json
{
  "type": 4,
  "data": {
    "content": "🏆 Stats loaded!",
    "embeds": [ ... ],
    "components": [ ... ],
    "flags": 64
  }
}
```

(Type 4 = `CHANNEL_MESSAGE_WITH_SOURCE`. See [Discord docs](https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object).)

### Error Handling

- Your handler should respond within **8 seconds** (SpaceBot enforces a timeout)
- If your handler returns a non-200 status or times out, SpaceBot shows an error message to the user
- Return appropriate HTTP error codes (400, 500, etc.) for errors — SpaceBot will show a friendly fallback message

---

## Lifecycle Webhooks

SpaceBot will call these URLs when a guild admin enables or disables your integration:

### `on_enable`

```http
POST https://your-game.com/api/spacebot/on-enable
Content-Type: application/json
X-SpaceBot-Integration: my-awesome-game

{
  "event": "integration.enabled",
  "guild_id": "123456789012345678",
  "enabled_by": "234567890123456789",
  "config": {}
}
```

Use this to provision resources, create database records, or send a welcome message.

### `on_disable`

```http
POST https://your-game.com/api/spacebot/on-disable
Content-Type: application/json
X-SpaceBot-Integration: my-awesome-game

{
  "event": "integration.disabled",
  "guild_id": "123456789012345678"
}
```

Use this to clean up resources.

**Note:** Lifecycle webhooks are fire-and-forget. SpaceBot does not wait for or validate the response.

---

## Command Definition Reference

Commands follow the [Discord Application Command](https://discord.com/developers/docs/interactions/application-commands) structure:

| Field         | Type   | Description                                     |
| ------------- | ------ | ----------------------------------------------- |
| `name`        | string | Command name (1-32 chars, lowercase, no spaces) |
| `description` | string | Command description (1-100 chars)               |
| `type`        | number | `1` for slash command (CHAT_INPUT)              |
| `options`     | array  | Command options/subcommands (see below)         |

### Option Types

| Type              | Value | Description            |
| ----------------- | ----- | ---------------------- |
| SUB_COMMAND       | 1     | A subcommand           |
| SUB_COMMAND_GROUP | 2     | A group of subcommands |
| STRING            | 3     | Text input             |
| INTEGER           | 4     | Whole number           |
| BOOLEAN           | 5     | True/false             |
| USER              | 6     | Discord user selector  |
| CHANNEL           | 7     | Channel selector       |
| ROLE              | 8     | Role selector          |
| MENTIONABLE       | 9     | User or role           |
| NUMBER            | 10    | Decimal number         |
| ATTACHMENT        | 11    | File upload            |

### Config Schema Types

The `config_schema` lets guild admins configure your integration from the SpaceBot dashboard:

| Type      | Description                      |
| --------- | -------------------------------- |
| `string`  | Free text input                  |
| `channel` | Discord channel selector         |
| `role`    | Discord role selector            |
| `boolean` | Toggle switch                    |
| `select`  | Dropdown with predefined choices |

---

## Integration Actions

Beyond whole slash commands, an integration can contribute **actions** into SpaceBot's shared action system — the same one that powers the custom-command builder and automations. Server admins then compose their _own_ commands (custom name, options, response formatting) that call your action, or use it as an automation step.

Declare actions in your manifest. Each action `key` **must** be namespaced with your slug (e.g. `agapeverse.generate_poem`):

```json
{
	"actions": [
		{
			"key": "agapeverse.generate_poem",
			"name": "Generate Poem",
			"description": "Generate a poem from a theme",
			"icon": "📜",
			"configSchema": {
				"theme": {
					"type": "text",
					"label": "Theme",
					"supportsOptionRef": true,
					"required": true
				},
				"style": {
					"type": "select",
					"label": "Style",
					"choices": ["haiku", "sonnet", "free"]
				}
			},
			"returns": ["poem", "title"]
		}
	],
	"webhooks": {
		"action_handler": "https://your-app.example.com/api/spacebot/action"
	}
}
```

`configSchema` uses the same field types as built-in actions (`text`, `select`, `boolean`, `channel`, `user_source`, `number_source`, …). For convenience, SpaceBot also accepts the common aliases `type: "string"` (treated as `text`) and, on a `select`, `choices: [...]` (treated as `options: [...]`), so you can write whichever reads naturally. Options may be plain strings or `{ "value": …, "label": … }` objects.

**When the action runs**, SpaceBot POSTs to `webhooks.action_handler`:

```http
POST https://your-app.example.com/api/spacebot/action
Content-Type: application/json
X-SpaceBot-Integration: agapeverse
X-SpaceBot-Guild: 123456789012345678
```

```json
{
	"type": "action",
	"action_key": "agapeverse.generate_poem",
	"config": { "theme": "the sea", "style": "free" },
	"guild_id": "123456789012345678",
	"channel_id": "345678901234567890",
	"user": { "id": "234567890123456789", "username": "player1" },
	"integration_slug": "agapeverse"
}
```

**Your response** — return the fields you promised in `returns`; they become `{action.<field>}` in the admin's response template:

```json
{ "result": { "poem": "Roses are red…", "title": "Roses" } }
```

Or return `content` / `embeds` to control the reply directly (used when the admin didn't author a response template):

```json
{ "content": "📜 **Roses**\nRoses are red…" }
```

**Per-invocation visibility.** On a direct `content`/`embeds` response you may also set `ephemeral` to choose whether the reply is private to the invoking user or posted to the whole channel — decided per invocation by your handler:

```json
{ "embeds": [{ "title": "Ode", "description": "…" }], "ephemeral": false }
```

SpaceBot honors this generically (no per-integration logic). Because Discord fixes a reply's ephemerality when the command is deferred, the rule is:

- Give the command a **response template** and it keeps its static `ephemeral` setting (your `ephemeral` on the response is not used).
- Leave the command **without** a response template (so your direct `content`/`embeds` are used) and set the command's `ephemeral: true`. Then a response with `ephemeral: true` (or omitted) stays private, and a response with `ephemeral: false` is **promoted to a public followup** in the channel (the ephemeral reply becomes a short "posted" acknowledgement). This lets one command decide, per run, between a private reply and a public post.

The 8-second timeout and offline handling are the same as the command handler.

**Authenticating the request.** Like the command handler, SpaceBot identifies itself with the `X-SpaceBot-Integration` (your slug) and `X-SpaceBot-Guild` headers — there is **no HMAC signature** on this call. Because the `action_handler` URL is only ever known to SpaceBot (from your synced manifest), treat the URL as a shared secret: verify the `X-SpaceBot-Integration` header matches your slug, and if you want stronger assurance, embed an unguessable token in the handler URL itself (e.g. `…/api/spacebot/action?k=<random>`) and check it. The exact request contract is: `POST`, JSON body with `type: "action"`, `action_key`, `config` (resolved), `guild_id`, `channel_id`, `user` (`{id, username}` or `null`), `integration_slug`.

---

## Integration Events

An integration can declare **event types** and push them into SpaceBot's automation engine, so a server admin can build automations triggered by activity on your platform (a poem published, a new account created, …).

Declare events in your manifest. Each `type` **must** be namespaced with your slug:

```json
{
	"events": [
		{
			"type": "agapeverse.poem_created",
			"label": "Poem created",
			"description": "A new poem was published on AgapeVerse",
			"icon": "📜",
			"category": "agapeverse",
			"fields": ["title", "author", "url"]
		}
	]
}
```

Platform-wide events route to the integration's **official guild** only — a SpaceBot superadmin designates that guild when registering your integration. Push events to:

```http
POST /api/v1/integrations/events
Authorization: Bearer sbi_your-slug_yourtoken123...
Content-Type: application/json

{
	"type": "agapeverse.poem_created",
	"details": { "title": "Roses", "author": "player1", "url": "https://agapeverse.app/p/roses" },
	"summary": "player1 published \"Roses\""
}
```

- The `type` must be namespaced and **declared in your manifest** (undeclared types are rejected).
- SpaceBot routes the event to your official guild and runs any automations whose trigger matches the type.
- `details.*` fields are available to automation action templates.

**Response:**

```json
{
	"success": true,
	"event_type": "agapeverse.poem_created",
	"guild_id": "…",
	"automations_triggered": 2
}
```

---

## Command Templates

Ship ready-made commands a server owner can **apply with one click**, then modify. SpaceBot _clones_ the template into the guild's own commands (created disabled, with server-specific references cleared) — there's no live link back, so the owner edits it like any other command.

Declare templates in your manifest. Each is a full command definition (built on one of your actions):

```json
{
	"command_templates": [
		{
			"key": "agapeverse.verse",
			"name": "verse",
			"summary": "Generate a poem from a theme",
			"description": "Generate a poem",
			"options": [
				{
					"name": "theme",
					"type": 3,
					"description": "What to write about",
					"required": true
				}
			],
			"action_type": "agapeverse.generate_poem",
			"action_config": { "theme": "option:theme", "style": "free" },
			"response_type": "embed",
			"response_embed": { "title": "{action.title}", "description": "{action.poem}" }
		}
	]
}
```

Bind a command option into the action config with the string form `"option:<name>"`. There is no webhook for templates — they are pure manifest data; SpaceBot's dashboard renders them and handles the clone.

### Option-driven visibility (ephemeral)

A template's `ephemeral` is normally a static boolean. It can instead be tied to one of the command's own options — a **boolean option** (private when it's on) or a **choice option** (private when a particular choice is selected) — so the invoking user chooses per run whether the reply is private. Unlike the handler-return approach above (§ "Per-invocation visibility"), this is declared entirely in the manifest, needs no `action_handler`, is resolved **before** the defer decision (so it works with `defer: true`), and coexists with a `response_type`/`response_embed` template.

Authoring forms:

```jsonc
// Boolean option, shorthand: a string in `ephemeral` names the option. Private
// iff that option is truthy; public when the option is omitted.
{
  "name": "verse",
  "options": [{ "name": "private", "type": 5, "description": "Keep it to yourself" }],
  "ephemeral": "option:private"          // or just "private"; "!public" negates
}

// Boolean option, explicit: keep a boolean fallback for when the option is omitted.
{
  "name": "verse",
  "options": [{ "name": "public", "type": 5, "description": "Post it for everyone" }],
  "ephemeral": true,                      // default private when `public` is absent
  "ephemeral_option": "!public"           // public option ON → not ephemeral
}

// Choice option: private when the selected value matches. Use "<name>=<value>";
// list several with commas; a leading "!" inverts.
{
  "name": "verse",
  "options": [
    { "name": "visibility", "type": 3, "description": "Who sees it",
      "choices": [
        { "name": "Public",  "value": "public" },
        { "name": "Private", "value": "private" }
      ] }
  ],
  "ephemeral": "visibility=private"       // or "visibility=private,dm"; "!tier=free" inverts
}
```

Rules:

- The referenced option **must be declared** on the same template, or sync **rejects** the manifest.
- **Boolean form** (`<name>`): ephemeral iff the option is truthy. **Choice/equality form** (`<name>=<value>[,<value>…]`): ephemeral iff the selected value is one of the listed choices (case-insensitive; integer choice values compared as strings).
- A leading `!` negates either form; an `option:` prefix is optional.
- If the user omits the option, the static `ephemeral` boolean is the fallback default.

The dashboard's command builder exposes the same binding, so an owner can add or change it on the cloned command afterward.

---

## Example: Minimal Integration

Here's the simplest possible integration — a single command with no subcommands:

### Manifest (`spacebot-integration.json`)

```json
{
	"name": "Hello World",
	"slug": "hello-world",
	"version": "1.0.0",
	"description": "A simple hello world integration",
	"icon": "👋",
	"category": "utility",

	"commands": [
		{
			"name": "hello",
			"description": "Say hello!",
			"type": 1
		}
	],

	"webhooks": {
		"command_handler": "https://my-app.example.com/api/spacebot/command"
	}
}
```

### Command Handler (Node.js/Express example)

```js
app.post('/api/spacebot/command', (req, res) => {
	const { command, user } = req.body;

	if (command === 'hello') {
		return res.json({
			content: `👋 Hello, ${user.username}!`,
		});
	}

	res.status(404).json({ error: 'Unknown command' });
});
```

### Heartbeat (using setInterval)

```js
const SPACEBOT_URL = 'https://spacebot.starspace.group';
const TOKEN = process.env.SPACEBOT_INTEGRATION_TOKEN;

// Send heartbeat every 2 minutes
setInterval(
	async () => {
		try {
			await fetch(`${SPACEBOT_URL}/api/v1/integrations/heartbeat`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ version: '1.0.0' }),
			});
		} catch (err) {
			console.error('Heartbeat failed:', err.message);
		}
	},
	2 * 60 * 1000
);
```

### Sync on Startup

```js
async function syncManifest() {
	const manifest = await fs.readFile('spacebot-integration.json', 'utf-8');

	const res = await fetch(`${SPACEBOT_URL}/api/v1/integrations/sync`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: manifest,
	});

	const result = await res.json();
	console.log('Manifest synced:', result);
}

// Sync when the server starts
syncManifest();
```

---

## Example: \*Space Game Integration

The \*Space Game is the reference integration for SpaceBot. Here's how it works:

| What            | URL                                                      |
| --------------- | -------------------------------------------------------- |
| Manifest        | `https://game.starspace.group/spacebot-integration.json` |
| Command Handler | `https://game.starspace.group/api/spacebot/command`      |
| Health Check    | `https://game.starspace.group/api/spacebot/health`       |
| On Enable       | `https://game.starspace.group/api/spacebot/on-enable`    |
| On Disable      | `https://game.starspace.group/api/spacebot/on-disable`   |

Commands provided:

- `/game stats [player]` — View player statistics
- `/game leaderboard [category]` — Server leaderboard
- `/game play` — Get the game link

The Game project syncs its manifest when it starts up and sends heartbeats every 2 minutes. When SpaceBot is offline or the Game project adds new commands, it calls the sync endpoint and all guilds automatically get the updated command list.

---

## Security Considerations

- **Integration tokens** are long-lived secrets. Store them in environment variables, never in source code.
- **Webhook URLs** must use HTTPS in production.
- SpaceBot identifies itself via the `X-SpaceBot-Integration` and `X-SpaceBot-Guild` headers. You can verify these match expected values.
- Command handler responses are displayed to Discord users — sanitize any user-generated content in your responses.
- SpaceBot enforces an **8-second timeout** on command handler webhooks. For long-running operations, return an immediate acknowledgment and use Discord's follow-up message API.

---

## Status & Monitoring

SpaceBot tracks integration health:

| Status    | Meaning                                      |
| --------- | -------------------------------------------- |
| `online`  | Heartbeat received within the last 5 minutes |
| `offline` | No heartbeat for 5+ minutes                  |
| `unknown` | Integration has never sent a heartbeat       |

When an integration is offline, SpaceBot will show users a friendly error message instead of silently failing when they try to use integration commands.

Guild admins can see integration status on the **Integrations** page in the SpaceBot dashboard.
