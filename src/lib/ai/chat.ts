/**
 * Cloudflare AI Chat Module with MCP Tool Support
 *
 * Integrates with Cloudflare Workers AI via REST API or AI Gateway
 * for LLM-based conversations with function calling capabilities.
 */

import { log } from '../log.js';
import { getMCPClient, formatToolsForPrompt, MCP_TOOLS } from './mcp-client.js';

// Default model - Llama 3.3 70B is smarter and better at reasoning
// Other options:
//   @cf/meta/llama-3.1-8b-instruct-fast - Fast but less capable
//   @cf/meta/llama-3.1-70b-instruct - Slower but smarter
//   @cf/meta/llama-3.3-70b-instruct-fp8-fast - Best balance of speed and intelligence
export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Local Ollama defaults. The Ollama path is opt-in via AI_PROVIDER=ollama and is
// intended for LOCAL DEVELOPMENT only — Cloudflare Workers (production) cannot
// reach localhost, and the gate var lives only in the local .env. Workers AI
// stays the production default.
export const DEFAULT_OLLAMA_MODEL = 'gemma3:4b';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Whether the local Ollama provider is selected (dev-only).
 * @param {Object} env
 * @returns {boolean}
 */
export function isOllamaSelected(env) {
	return String(env?.AI_PROVIDER || '').toLowerCase() === 'ollama';
}

/**
 * Call a local Ollama chat model via /api/chat. Returns the assistant text.
 * @param {{ system: string, messages: Array<{role: string, content: string}>, model: string, baseUrl: string }} opts
 * @returns {Promise<string>}
 */
async function callOllamaChat({ system, messages, model, baseUrl }) {
	const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
	const body = {
		model,
		stream: false,
		messages: [{ role: 'system', content: system }, ...messages],
	};

	log.debug(`[AI] Sending request to Ollama model=${model} at ${url}`);
	// Bound the request so a hung/slow local Ollama can't block the DM handler
	// indefinitely. Default 120s to tolerate cold model loads (the first call after
	// a model is pulled can be slow); override with OLLAMA_TIMEOUT_MS. Dev-only path.
	const envTimeout = Number(
		typeof process !== 'undefined' ? process.env?.OLLAMA_TIMEOUT_MS : undefined
	);
	const OLLAMA_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 120000;
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
			throw new Error(`Ollama request timed out after ${OLLAMA_TIMEOUT_MS}ms at ${url}`);
		}
		throw new Error(`Could not reach Ollama at ${url}: ${err?.message || err}`);
	}

	if (!response.ok) {
		const errText = await response.text().catch(() => '');
		throw new Error(`Ollama returned HTTP ${response.status}: ${errText}`);
	}

	const data = await response.json();
	const text = (data?.message?.content ?? '').trim();
	if (!text) {
		throw new Error('Ollama returned an empty response.');
	}
	console.info(`[AI] Completion provider=ollama model=${model}`);
	return text;
}

// Base system prompt for the bot assistant
const BASE_SYSTEM_PROMPT = `You are SpaceBot, a helpful Discord bot assistant created by Starspace.

## PERMISSION HIERARCHY

SpaceBot has a layered permission system. You MUST understand who you're talking to:

### 1. Platform Superadmin
- Has access to ALL servers where SpaceBot is installed
- Can view cross-server data and analytics
- Can run maintenance tasks and cron jobs
- Can access diagnostic/debug tools
- Can manage global bot settings

### 2. Discord Server Admin (Administrator permission)
- Full control of SpaceBot for THEIR servers only
- Can manage server settings, webhooks, scheduled events
- Can create/edit/delete automations and custom commands
- Can view all logs and statistics
- Can configure permission settings for other roles

### 3. Discord Server Manager (Manage Server permission)
- Can view dashboard, logs, and statistics
- Can create/edit automations and commands (if allowed)
- Cannot access server settings or configure permissions
- Limited to servers they manage

### 4. Regular Discord User
- Cannot DM you for admin features
- Can only use bot commands in servers
- Their access depends on server permission settings

## DATA SOURCES

You have TWO sources of data:

### 1. LIVE DATA (in context below) - Use for CURRENT state:
- Member count, online count, channel count, role count, emoji count, boosts
- Who's in voice chat RIGHT NOW, which voice channels are active
- Server name, ID, boost level

### 2. DATABASE TOOLS - Use for HISTORICAL data:
- "How many messages in the last week?" → Use get_activity_summary
- "Who's been most active?" → Use get_activity_summary  
- "Voice activity over the last 3 days?" → Use get_voice_activity with days=3
- "How many people joined this month?" → Use get_event_logs with since date
- Event logs, automations, commands, settings

## WHEN TO USE WHAT

**Use LIVE DATA from context for:**
- Current member/online counts
- Current voice chat status (who's in voice RIGHT NOW)
- Current channel/role/emoji counts
- Boost level

**Use get_voice_activity tool for:**
- Voice hours/time spent in voice chat (use days=1 for today)
- Historical voice stats (last X days)
- Top voice users by time spent, most popular voice channels
- Total voice joins over time

**Use get_activity_summary tool for:**
- Overall server activity (messages, joins, leaves, voice, reactions)
- Top active members
- Most active channels

**Use get_event_logs tool for:**
- Specific event searches with date filters
- Finding specific users' activity
- Raw event data

## SENDING MESSAGES TO CHANNELS

You can send messages to Discord channels on the user's behalf. For requests like "send event links to #announcements":

1. **Find the channel**: Use \`get_text_channels\` with a nameFilter to find the channel ID
   - Example: \`get_text_channels\` with nameFilter "announcements" to find #announcements
2. **Get the content**: Use the appropriate tool to gather the information
   - For events: Use \`get_scheduled_events\` with nameFilter to find matching events
   - Events include an \`eventLink\` property with a shareable Discord URL
3. **Send the message**: Use \`send_channel_message\` with the channel ID and formatted content
   - Format event links nicely with the event name and link
   - Consider using embeds for better presentation

**Example workflow for "send hockey event links to #announcements":**
1. Call \`get_text_channels\` with nameFilter="announcements" → get channel ID
2. Call \`get_scheduled_events\` with nameFilter="hockey" → get hockey events with links
3. Format a message with the event names and links
4. Call \`send_channel_message\` with the channel ID and formatted message

## LOCAL RUNNERS IN DMS

In DMs, you CAN inspect and control the user's registered local runners using local-runner tools. A live snapshot of the user's runners is included below under "USER'S LOCAL RUNNERS" — read it first; it already answers "what runners do I have / are they online" without a tool call. Use tools when you need fresher data or to act.

- For runner discovery/status questions ("can you see my runner", "list my runners", "is my runner online"), use \`list_local_runners\`.
- For current jobs and event timeline, use \`get_local_runner_activity\`.
- For executing commands on local systems, use \`start_local_runner_task\`.
- For inspecting a specific job's output, exit code, or failure, use \`get_local_runner_job\`.
- For stopping/aborting a pending or running task, use \`cancel_local_runner_job\`.
- For re-queueing a failed or canceled task, use \`retry_local_runner_job\`.
- For VS Code window detection and context, use \`discover_vscode_instances\`.
- For opening folders/workspaces or creating a new VS Code window, use \`open_vscode_workspace\`.
- For Copilot Chat back-and-forth from DM, use \`send_vscode_copilot_message\` with a stable \`conversationKey\`.

When the user asks to stop, cancel, kill, abort, retry, or re-run a task, prefer these control tools over starting a new task. If you don't know the job ID, call \`get_local_runner_activity\` first to find it.

Never claim you "don't have access" to local runners without trying these tools first. If no runners are registered, say that clearly and explain how to register one.

## HONESTY RULES

- Only report data that comes from context or tool results
- If a tool returns empty/zero, say so honestly
- Never invent or guess numbers
- For local-runner questions, do not claim counts, status, or activity unless a local-runner tool returned that exact data in this conversation

Keep responses concise. Use Discord markdown.`;

function detectLocalRunnerIntent(message = '') {
	const text = String(message || '').toLowerCase();
	const mentionsRunner =
		/\b(local\s+runner|local\s+runners|runner|runners|registered\s+runner|registered\s+runners)\b/i.test(
			text
		);
	const asksVisibility =
		/\b(can\s+you\s+see|do\s+you\s+see|show|list|status|online|offline|registered|what\s+runners|which\s+runners)\b/i.test(
			text
		);
	// Use word boundaries so words like "runner"/"runners" do not trip action intent via substring matches.
	const asksAction = /\b(run|execute|start|queue|trigger|launch|deploy|pull|restart)\b/i.test(
		text
	);

	return {
		mentionsRunner,
		asksVisibility,
		asksAction,
		// Treat runner mentions in DMs as visibility checks unless the user clearly asks to execute an action.
		isVisibilityQuery:
			mentionsRunner &&
			!asksAction &&
			(asksVisibility || /^\s*local\s+runners\??\s*$/i.test(text)),
	};
}

function formatRunnerVisibilityResponse(runners = []) {
	if (!Array.isArray(runners) || runners.length === 0) {
		return [
			"I checked and I don't see any registered local runner systems for your account yet.",
			'You can create a runner token in Account -> Local Runners, start the runner script, and then I can see it here.',
		].join('\n\n');
	}

	const online = runners.filter((runner) => runner.is_online).length;
	const lines = runners.slice(0, 8).map((runner) => {
		const status = runner.is_online ? 'online' : 'offline';
		const name = runner.display_name || runner.hostname || `Runner ${runner.id}`;
		const host = runner.hostname ? ` (${runner.hostname})` : '';
		const token = runner.token_name ? ` | token ${runner.token_name}` : '';
		const platform = [runner.platform, runner.platform_release, runner.arch]
			.filter(Boolean)
			.join(' ');
		const platformText = platform ? ` | ${platform}` : '';
		const workdir = runner.default_workdir ? ` | wd ${runner.default_workdir}` : '';
		const pending = Number(runner.pending_job_count || 0);
		const running = Number(runner.running_job_count || 0);
		const seenAt = runner.last_seen_at ? ` | last seen ${runner.last_seen_at} UTC` : '';
		return `- ${name}${host}: ${status}${token}${platformText}${workdir} | pending ${pending} | running ${running}${seenAt}`;
	});

	const overflow = runners.length > 8 ? `\n- ...and ${runners.length - 8} more system(s)` : '';

	return `Yes. I can see ${runners.length} registered local runner system(s) (${online} online, ${runners.length - online} offline).\n\nHere is your current runner list:\n${lines.join('\n')}${overflow}`;
}

/**
 * Fetch the DM user's local-runner inventory once per turn so the system
 * prompt always knows what runners exist without waiting for the model to
 * think of calling a tool. Returns null-ish ok:false on failure — chat must
 * never break because the inventory lookup did.
 */
async function fetchRunnerInventory(env, userId) {
	try {
		const results = await executeToolCalls(
			[{ tool: 'list_local_runners', args: { includeOffline: true, limit: 100 } }],
			env,
			userId
		);
		const result = results[0]?.result;
		if (!result?.success || !Array.isArray(result.data)) {
			return { ok: false, error: result?.error || 'unknown error', runners: [] };
		}
		return { ok: true, runners: result.data };
	} catch (error) {
		return { ok: false, error: error?.message || String(error), runners: [] };
	}
}

/**
 * Render the runner inventory as a system-prompt section, including
 * orchestration guidance so the model proactively offers to run tasks.
 */
function buildRunnerInventorySection(inventory) {
	if (!inventory) return '';

	let section = "\n\n## USER'S LOCAL RUNNERS (LIVE DATA)\n";

	if (!inventory.ok) {
		section += `The runner inventory lookup failed (${inventory.error}). If the user asks about runners, retry with \`list_local_runners\` and be honest if it fails again.\n`;
		return section;
	}

	const runners = Array.isArray(inventory.runners) ? inventory.runners : [];
	if (runners.length === 0) {
		section +=
			'The user has NO registered local runner systems. If they ask to run something locally, explain how to set one up: create a token under Account -> Local Runners on the dashboard, then start the runner on their machine (`bun run runner`).\n';
		return section;
	}

	const online = runners.filter((runner) => runner.is_online).length;
	section += `This is the user's OWN registered local runners — you DO have this information. Answer any question about their runners (do they have one, which are online, names, platforms) directly from this list. Never say you "can't access" or "don't have" this data.\n\n`;
	section += `The user has ${runners.length} registered local runner system(s): ${online} online, ${runners.length - online} offline.\n\n`;

	for (const runner of runners.slice(0, 8)) {
		const name = runner.display_name || runner.hostname || `Runner ${runner.id}`;
		const status = runner.is_online ? '🟢 online' : '⚫ offline';
		const platform = [runner.platform, runner.arch].filter(Boolean).join('/');
		const pending = Number(runner.pending_job_count || 0);
		const running = Number(runner.running_job_count || 0);
		section += `- **${name}** (id ${runner.id}): ${status}`;
		if (runner.hostname && runner.hostname !== name) section += ` | host ${runner.hostname}`;
		if (platform) section += ` | ${platform}`;
		if (runner.default_workdir) section += ` | workdir ${runner.default_workdir}`;
		section += ` | jobs: ${pending} pending, ${running} running`;
		if (runner.last_seen_at) section += ` | last seen ${runner.last_seen_at} UTC`;
		section += '\n';
	}
	if (runners.length > 8) {
		section += `- ...and ${runners.length - 8} more (use list_local_runners for the full list)\n`;
	}

	section += `
### Orchestrating tasks on these runners
- You can run shell commands on these machines with \`start_local_runner_task\` (target a specific runner by name/id when the user names one, otherwise prefer an online runner).
- After queueing, report the job ID and offer to check on it; use \`get_local_runner_job\` to fetch output/exit code and \`get_local_runner_activity\` for the overall queue.
- Offline runners can still accept queued jobs — they run them on reconnect. Say so when targeting one.
- For multi-step requests ("build X then deploy"), queue steps one at a time and check each result before continuing, narrating progress to the user.
- Confirm before destructive commands (deletes, resets, force-pushes). Never invent job results — only report what the tools returned.\n`;

	return section;
}

interface GuildPermissions {
	administrator?: boolean;
	manageGuild?: boolean;
	manageChannels?: boolean;
	manageRoles?: boolean;
	manageMessages?: boolean;
	manageWebhooks?: boolean;
	manageEvents?: boolean;
	kickMembers?: boolean;
	banMembers?: boolean;
	[key: string]: any;
}

interface VoiceChannelInfo {
	name: string;
	memberCount: number;
	members?: string[];
	[key: string]: any;
}

interface ManagedGuild {
	id: string;
	name: string;
	isOwner?: boolean;
	isAdmin?: boolean;
	userRoles?: string[];
	permissions?: GuildPermissions;
	memberCount?: number;
	onlineCount?: number;
	channelCount?: number;
	roleCount?: number;
	emojiCount?: number;
	boostCount?: number;
	boostLevel?: number;
	voiceMemberCount?: number;
	voiceChannels?: VoiceChannelInfo[];
	[key: string]: any;
}

interface SystemPromptContext {
	isSuperAdmin?: boolean;
	mcpEnabled?: boolean;
	managedGuilds?: ManagedGuild[];
	selectedGuild?: ManagedGuild | null;
	selectedGuildId?: string | null;
	selectedGuildName?: string | null;
	runnerInventory?: { ok: boolean; error?: string; runners: any[] } | null;
	[key: string]: any;
}

/**
 * Build the full system prompt with context
 */
function buildSystemPrompt(context: SystemPromptContext = {}) {
	let prompt = BASE_SYSTEM_PROMPT;

	// Add detailed user permission context
	prompt += `\n\n## 🔐 CURRENT USER PERMISSIONS\n`;

	// Platform-level permissions
	prompt += `### Platform Access:\n`;
	if (context.isSuperAdmin) {
		prompt += `- **Role:** 👑 SUPERADMIN (full platform access)\n`;
		prompt += `- Can access ALL servers where SpaceBot is installed\n`;
		prompt += `- Can view cross-server analytics and data\n`;
		prompt += `- Can run maintenance tasks and cron jobs\n`;
		prompt += `- Can access diagnostic/debug tools\n`;
		prompt += `\nWhen they ask about "all servers" or cross-server data, you can provide it.\n`;
	} else {
		prompt += `- **Role:** Server Manager (limited to their own servers)\n`;
		prompt += `- Can ONLY access servers where they have Manage Server or Administrator permission\n`;
		prompt += `- Cannot view data from other servers\n`;
		prompt += `- Cannot run global maintenance or cron tasks\n`;
	}

	// Add selected server context with detailed permissions
	if (context.selectedGuildId && context.selectedGuildName) {
		const selectedGuild = context.managedGuilds?.find((g) => g.id === context.selectedGuildId);

		prompt += `\n### 🎯 CURRENTLY SELECTED SERVER: ${context.selectedGuildName}\n`;
		prompt += `**Server ID:** ${context.selectedGuildId}\n\n`;

		// Show user's specific permissions for this server
		prompt += `**User's permissions on this server:**\n`;
		if (context.isSuperAdmin) {
			prompt += `- ✅ Full access (Superadmin override)\n`;
			prompt += `- ✅ Can view all logs and statistics\n`;
			prompt += `- ✅ Can manage automations and commands\n`;
			prompt += `- ✅ Can change server settings\n`;
			prompt += `- ✅ Can manage webhooks\n`;
		} else if (selectedGuild) {
			// Detailed server permissions
			if (selectedGuild.isOwner) {
				prompt += `- 👑 **Server Owner** - Full control of this server\n`;
			}
			if (selectedGuild.isAdmin) {
				prompt += `- ✅ **Administrator** - Can change all server settings\n`;
			} else {
				prompt += `- ⚠️ **Manager** - Cannot change server settings (requires Administrator)\n`;
			}

			// What they CAN do
			prompt += `- ✅ Can view dashboard and statistics\n`;
			prompt += `- ✅ Can view event logs\n`;
			prompt += selectedGuild.isAdmin
				? `- ✅ Can create/edit/delete automations\n`
				: `- ⚠️ Automation editing depends on server permission settings\n`;
			prompt += selectedGuild.isAdmin
				? `- ✅ Can create/edit/delete custom commands\n`
				: `- ⚠️ Command editing depends on server permission settings\n`;
			prompt += selectedGuild.isAdmin
				? `- ✅ Can manage server settings and webhooks\n`
				: `- ❌ Cannot manage server settings (requires Administrator)\n`;
		}

		prompt += `\n**IMPORTANT:** When the user asks about "my server", "the server", stats, logs, automations, etc., use this server's ID (${context.selectedGuildId}) in all tool calls.\n`;
		prompt += `Do NOT ask them which server - they have already selected it.\n`;

		// Add permission-aware guidance
		if (!context.isSuperAdmin && selectedGuild && !selectedGuild.isAdmin) {
			prompt += `\n**Note:** If the user tries to do something they don't have permission for (like changing server settings), politely explain that they need the Administrator permission for that action.\n`;
		}
	} else if (context.managedGuilds && context.managedGuilds.length > 1) {
		prompt += `\n### ⚠️ NO SERVER SELECTED\n`;
		prompt += `The user manages ${context.managedGuilds.length} servers but hasn't selected one yet.\n`;
		prompt += `When they ask about server-specific data, remind them to select a server first.\n`;
		prompt += `They can say: "switch to <server name>", "select <server>", or "list servers"\n`;
	} else if (context.managedGuilds?.length === 1) {
		prompt += `\n### 📍 Single Server User\n`;
		prompt += `User only manages one server, so that server is auto-selected.\n`;
	}

	// Add managed guilds context if available - including live stats and permissions
	if (context.managedGuilds && context.managedGuilds.length > 0) {
		prompt +=
			"\n\n## User's Managed Servers (LIVE DATA)\nThe user manages the following Discord servers where SpaceBot is installed. This data is LIVE from Discord:\n";
		for (const guild of context.managedGuilds) {
			const isSelected = context.selectedGuildId === guild.id;

			// Build permission badges
			const badges = [];
			if (isSelected) badges.push('✅ SELECTED');
			if (guild.isOwner) badges.push('👑 Owner');
			else if (guild.isAdmin) badges.push('🛡️ Admin');
			else badges.push('⚙️ Manager');

			prompt += `\n### ${guild.name} [${badges.join(' | ')}]\n`;
			prompt += `- Server ID: ${guild.id}\n`;

			// User's permission level on this server
			prompt += `- User's Access: ${guild.isOwner ? 'Server Owner' : guild.isAdmin ? 'Administrator' : 'Manage Server'}\n`;

			// Show user's Discord roles on this server
			if (guild.userRoles && guild.userRoles.length > 0) {
				prompt += `- User's Roles: ${guild.userRoles.join(', ')}\n`;
			}

			// Show detailed Discord permissions for this user
			if (guild.permissions) {
				const perms = guild.permissions;
				const permList = [];
				if (perms.administrator) permList.push('Administrator');
				if (perms.manageGuild) permList.push('Manage Server');
				if (perms.manageChannels) permList.push('Manage Channels');
				if (perms.manageRoles) permList.push('Manage Roles');
				if (perms.manageMessages) permList.push('Manage Messages');
				if (perms.manageWebhooks) permList.push('Manage Webhooks');
				if (perms.manageEvents) permList.push('Manage Events');
				if (perms.kickMembers) permList.push('Kick Members');
				if (perms.banMembers) permList.push('Ban Members');
				if (permList.length > 0) {
					prompt += `- Discord Permissions: ${permList.join(', ')}\n`;
				}
			}

			if (guild.memberCount !== undefined) prompt += `- Members: ${guild.memberCount}\n`;
			if (guild.onlineCount !== undefined) prompt += `- Online: ${guild.onlineCount}\n`;
			if (guild.channelCount !== undefined) prompt += `- Channels: ${guild.channelCount}\n`;
			if (guild.roleCount !== undefined) prompt += `- Roles: ${guild.roleCount}\n`;
			if (guild.emojiCount !== undefined) prompt += `- Custom Emojis: ${guild.emojiCount}\n`;
			if (guild.boostCount !== undefined)
				prompt += `- Boosts: ${guild.boostCount} (Level ${guild.boostLevel})\n`;
			// Voice channel stats
			if (guild.voiceMemberCount !== undefined) {
				prompt += `- Members in Voice: ${guild.voiceMemberCount}\n`;
				if (guild.voiceChannels && guild.voiceChannels.length > 0) {
					prompt += `- Active Voice Channels:\n`;
					for (const vc of guild.voiceChannels) {
						prompt += `  - ${vc.name}: ${vc.memberCount} member${vc.memberCount !== 1 ? 's' : ''}`;
						if (vc.members && vc.members.length > 0) {
							prompt += ` (${vc.members.join(', ')}${vc.memberCount > 10 ? '...' : ''})`;
						}
						prompt += `\n`;
					}
				}
			}
		}
		prompt +=
			'\n**For basic questions like member count, voice chat, use the data above directly. Use database tools for historical stats, logs, automations, and commands.**\n';
	}

	// Add MCP tools if enabled, or explain the limitation
	if (context.mcpEnabled) {
		prompt += '\n\n## Available Tools\n';
		prompt += formatToolsForPrompt();
	} else {
		prompt += '\n\n## ⚠️ LIMITED DATA ACCESS ⚠️\n';
		prompt += 'Live database tools are NOT available on this path. You cannot look up:\n';
		prompt += '- Event logs, message counts, join counts, or historical statistics\n';
		prompt += '- Automation names, configurations, or execution history\n';
		prompt += '- Custom command details or usage logs\n';
		prompt += '- Server settings\n\n';

		const dashboardBase = 'https://spacebot.starspace.group';
		const serverPath = context.selectedGuildId ? `/admin/${context.selectedGuildId}` : '';

		prompt +=
			"When the user asks about the items above, tell them you can't look up that data right now and direct them to the appropriate dashboard page.\n";
		prompt += 'Use the most relevant link based on their question:\n';
		prompt += `- Stats/activity/members/growth → ${dashboardBase}${serverPath}/stats\n`;
		prompt += `- Event logs/message history → ${dashboardBase}${serverPath}/logs\n`;
		prompt += `- Automations → ${dashboardBase}${serverPath}/automations\n`;
		prompt += `- Commands → ${dashboardBase}${serverPath}/commands\n`;
		prompt += `- Server settings → ${dashboardBase}${serverPath}/settings\n`;
		prompt += `- General/unclear → ${dashboardBase}${serverPath}\n\n`;
		prompt +=
			'Do NOT guess or fabricate statistics. This limitation does NOT apply to the local-runner and live-server data provided elsewhere in this prompt — that information is accurate, so use it.';
	}

	// Live local-runner inventory LAST so it's the freshest instruction — small
	// local models weight the end of the prompt heavily, and this must override
	// any "no data access" hedging above for runner questions.
	prompt += buildRunnerInventorySection(context.runnerInventory);

	return prompt;
}

/**
 * Parse tool calls from AI response
 * Looks for tool JSON in various formats
 */
function parseToolCalls(response) {
	const toolCalls = [];

	// Try multiple patterns the AI might use
	const patterns = [
		/```tool\s*\n([\s\S]*?)```/g, // ```tool\n{...}```
		/```json\s*\n([\s\S]*?)```/g, // ```json\n{...}```
		/```\s*\n(\{"tool"[\s\S]*?)```/g, // ```\n{"tool":...}```
		/(?:^|\n)(\{"tool"\s*:\s*"[^"]+"[^}]*\})/g, // Raw JSON with "tool" key
	];

	for (const regex of patterns) {
		let match;
		while ((match = regex.exec(response)) !== null) {
			try {
				const jsonStr = match[1].trim();
				const parsed = JSON.parse(jsonStr);
				if (parsed.tool && typeof parsed.tool === 'string') {
					// Avoid duplicates
					if (
						!toolCalls.some(
							(t) =>
								t.tool === parsed.tool &&
								JSON.stringify(t.args) === JSON.stringify(parsed.args || {})
						)
					) {
						toolCalls.push({
							tool: parsed.tool,
							args: parsed.args || {},
						});
						log.debug(`[AI] Parsed tool call: ${parsed.tool}`);
					}
				}
			} catch {
				log.warn('[AI] Failed to parse tool call:', match[1]);
			}
		}
	}

	return toolCalls;
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls, env, userId = null) {
	const mcpClient = getMCPClient(env);

	if (!mcpClient.isConfigured()) {
		return [
			{
				tool: 'error',
				result: {
					success: false,
					error: 'MCP client not configured - missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN',
				},
			},
		];
	}

	// Local-runner tools operate on the DM user's own machines. The user id
	// MUST come from the authenticated session, never from model-supplied args,
	// or a crafted tool call could target another account's runners.
	const LOCAL_RUNNER_TOOLS = new Set([
		'list_local_runners',
		'get_local_runner_activity',
		'start_local_runner_task',
		'get_local_runner_job',
		'cancel_local_runner_job',
		'retry_local_runner_job',
		'discover_vscode_instances',
		'open_vscode_workspace',
		'send_vscode_copilot_message',
	]);

	const results = [];

	for (const call of toolCalls) {
		log.info(`[AI] Executing tool: ${call.tool}`);

		const forceSessionUser = userId && LOCAL_RUNNER_TOOLS.has(call.tool);

		// Inject environment variables for tools that need them (e.g., image generation)
		const argsWithEnv = {
			...call.args,
			_env: env, // Internal parameter for Cloudflare AI access
			// Runner tools are pinned to the session user; other tools fall back
			// to the session user only when the model didn't attribute one.
			userId: forceSessionUser ? userId : call.args.userId || userId,
		};

		const result = await mcpClient.executeTool(call.tool, argsWithEnv);
		results.push({
			tool: call.tool,
			args: call.args, // Don't expose _env in the formatted output
			result,
		});
	}

	return results;
}

/**
 * Summarize an automation for AI display (keeps essential info, drops verbose config)
 */
function summarizeAutomation(auto) {
	// Convert enabled 0/1 to clear status string for AI understanding
	const isEnabled = auto.enabled === 1 || auto.enabled === true;
	return {
		id: auto.id,
		name: auto.name,
		status: isEnabled ? 'ACTIVE' : 'INACTIVE',
		trigger_events: auto.trigger_events,
		action_type: auto.action_type,
		trigger_count: auto.trigger_count,
		created_by: auto.created_by,
		last_triggered_at: auto.last_triggered_at,
	};
}

/**
 * Summarize a command for AI display
 */
function summarizeCommand(cmd) {
	const isEnabled = cmd.enabled === 1 || cmd.enabled === true;
	return {
		id: cmd.id,
		name: cmd.name,
		description: cmd.description,
		status: isEnabled ? 'ACTIVE' : 'INACTIVE',
		use_count: cmd.use_count,
		created_by: cmd.created_by,
	};
}

/**
 * Format tool results for the AI to process
 */
function formatToolResults(results) {
	let formatted = 'Tool Results:\n\n';

	for (const { tool, args, result } of results) {
		formatted += `### ${tool}\n`;
		if (args && Object.keys(args).length > 0) {
			formatted += `Arguments: ${JSON.stringify(args)}\n`;
		}
		if (result.success) {
			let data = result.data;

			// For array results, provide count and summarize items
			if (Array.isArray(data)) {
				formatted += `Total items: ${data.length}\n`;

				// Summarize specific types to reduce token usage
				if (tool === 'get_automations' && data.length > 0) {
					data = data.map(summarizeAutomation);
					// Add status counts for clarity
					const activeCount = data.filter((a) => a.status === 'ACTIVE').length;
					const inactiveCount = data.filter((a) => a.status === 'INACTIVE').length;
					formatted += `Status breakdown: ${activeCount} ACTIVE, ${inactiveCount} INACTIVE\n`;
				} else if (tool === 'get_commands' && data.length > 0) {
					data = data.map(summarizeCommand);
					const activeCount = data.filter((c) => c.status === 'ACTIVE').length;
					const inactiveCount = data.filter((c) => c.status === 'INACTIVE').length;
					formatted += `Status breakdown: ${activeCount} ACTIVE, ${inactiveCount} INACTIVE\n`;
				}
			}

			// Truncate large results to avoid token limits (increased from 2000)
			const dataStr = JSON.stringify(data, null, 2);
			if (dataStr.length > 8000) {
				formatted += `Result (truncated):\n${dataStr.substring(0, 8000)}...\n\n`;
			} else {
				formatted += `Result:\n${dataStr}\n\n`;
			}
		} else {
			formatted += `Error: ${result.error}\n\n`;
		}
	}

	return formatted;
}

/**
 * Build an ordered list of model IDs to try, deduplicating across
 * CLOUDFLARE_AI_MODELS (array) and CLOUDFLARE_AI_MODEL (string fallback).
 */
function normalizeModelList(env) {
	const candidates = Array.isArray(env.CLOUDFLARE_AI_MODELS) ? [...env.CLOUDFLARE_AI_MODELS] : [];
	const single = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
	if (!candidates.includes(single)) candidates.push(single);
	return candidates.filter(Boolean);
}

/**
 * If round_robin routing, rotate the model list based on the current minute
 * so different requests in the same minute always go to the same model.
 */
function buildModelOrder(models, env) {
	if (!models.length) return [DEFAULT_MODEL];
	if (env.CLOUDFLARE_AI_MODEL_ROUTING === 'round_robin') {
		const minute = Math.floor(Date.now() / 60000);
		const offset = minute % models.length;
		return [...models.slice(offset), ...models.slice(0, offset)];
	}
	return models;
}

function parseUsageValue(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractUsageMetrics(payload) {
	const usage = payload?.result?.usage || payload?.usage || null;
	if (!usage || typeof usage !== 'object') {
		return null;
	}

	const inputTokens = parseUsageValue(
		usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens
	);
	const outputTokens = parseUsageValue(
		usage.output_tokens ??
			usage.completion_tokens ??
			usage.outputTokens ??
			usage.completionTokens
	);

	let totalTokens = parseUsageValue(usage.total_tokens ?? usage.totalTokens);

	if (totalTokens === null && inputTokens !== null && outputTokens !== null) {
		totalTokens = inputTokens + outputTokens;
	}

	return {
		inputTokens,
		outputTokens,
		totalTokens,
	};
}

/**
 * Call the AI API, trying each model in order until one succeeds.
 */
async function callAI(messages, env) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_AI_TOKEN;
	const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID;

	const modelList = buildModelOrder(normalizeModelList(env), env);
	let lastError;

	for (const model of modelList) {
		let apiUrl;
		if (gatewayId) {
			apiUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`;
		} else {
			apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
		}

		log.debug(
			`[AI] Sending request to ${gatewayId ? 'AI Gateway' : 'Workers AI'} model=${model}`
		);

		try {
			const response = await fetch(apiUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					messages,
					max_tokens: 1500,
					temperature: 0.2, // Low temperature to reduce hallucination/creativity
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				log.error(`[AI] API error ${response.status} for model ${model}: ${errorText}`);
				lastError = new Error(`AI service error: ${response.status}`);
				continue;
			}

			const data = await response.json();
			const usageMetrics = extractUsageMetrics(data);

			let responseText;
			if (data.result?.response) {
				responseText = data.result.response;
			} else if (data.response) {
				responseText = data.response;
			} else if (typeof data === 'string') {
				responseText = data;
			} else {
				lastError = new Error('Unexpected response format from AI service');
				continue;
			}

			const provider = gatewayId ? 'ai-gateway' : 'workers-ai';
			const usageSummary = usageMetrics
				? `input_tokens=${usageMetrics.inputTokens ?? 'n/a'} output_tokens=${usageMetrics.outputTokens ?? 'n/a'} total_tokens=${usageMetrics.totalTokens ?? 'n/a'}`
				: 'input_tokens=n/a output_tokens=n/a total_tokens=n/a';

			console.info(`[AI] Completion provider=${provider} model=${model} ${usageSummary}`);

			return responseText;
		} catch (err) {
			log.error(`[AI] Request failed for model ${model}: ${err.message}`);
			lastError = err;
		}
	}

	throw lastError || new Error('All AI models failed to respond');
}

/**
 * Generate a chat response with MCP tool support
 *
 * @param {Object} options - Chat options
 * @param {string} options.message - The user's message
 * @param {string} options.userName - The user's display name
 * @param {string} options.userId - The user's Discord ID
 * @param {boolean} [options.isSuperAdmin] - Whether user is a platform superadmin
 * @param {Object[]} [options.history] - Previous messages in the conversation
 * @param {Object[]} [options.managedGuilds] - Guilds the user manages (with isOwner, isAdmin flags)
 * @param {Object} [options.selectedGuild] - The currently selected guild object
 * @param {string} [options.selectedGuildId] - The currently selected guild ID
 * @param {string} [options.selectedGuildName] - The currently selected guild name
 * @param {number} [options.maxToolIterations] - Max tool call loop iterations (default: 5, max: 20)
 * @param {Object} env - Environment variables
 * @returns {Promise<{success: boolean, response?: string, error?: string, toolsUsed?: string[]}>}
 */
export async function generateChatResponse(options, env) {
	const {
		message,
		userName,
		userId,
		isSuperAdmin = false,
		history = [],
		managedGuilds = [],
		selectedGuild = null,
		selectedGuildId = null,
		selectedGuildName = null,
		maxToolIterations = 5,
	} = options;

	// Direct console.log for debugging (bypasses LOG_LEVEL)
	console.log('[AI] generateChatResponse called for user:', userName);
	console.log('[AI] env keys:', Object.keys(env || {}));
	console.log(
		'[AI] Selected server:',
		selectedGuildName || 'none',
		`(${selectedGuildId || 'none'})`
	);
	console.log('[AI] User is superadmin:', isSuperAdmin);

	// MCP (D1) access is independent of which chat provider answers, so resolve
	// the runner inventory up front. Both the local (Ollama) path and the
	// Workers AI path inject it, so even a local model that can't tool-call can
	// still answer "what runners do I have / are they online".
	const mcpClient = getMCPClient(env);
	const mcpEnabled = mcpClient.isConfigured();
	const runnerInventory = mcpEnabled && userId ? await fetchRunnerInventory(env, userId) : null;

	// Local Ollama path (opt-in via AI_PROVIDER=ollama). No MCP tool-calling —
	// local models don't use the Workers-AI tool format — so this is a plain
	// chat completion grounded with the runner inventory fetched above.
	if (isOllamaSelected(env)) {
		const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
		const baseUrl = env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
		const systemPrompt = buildSystemPrompt({
			managedGuilds,
			mcpEnabled: false,
			isSuperAdmin,
			selectedGuild,
			selectedGuildId,
			selectedGuildName,
			runnerInventory,
		});
		const ollamaMessages = [
			...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
			{ role: 'user', content: `[${userName}]: ${message}` },
		];
		try {
			const text = await callOllamaChat({
				system: systemPrompt,
				messages: ollamaMessages,
				model,
				baseUrl,
			});
			return { success: true, response: text };
		} catch (error) {
			log.error('[AI] Ollama request failed:', error.message);
			return { success: false, error: `Ollama request failed: ${error.message}` };
		}
	}

	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_AI_TOKEN;

	console.log('[AI] CLOUDFLARE_ACCOUNT_ID:', accountId ? 'SET' : 'MISSING');
	console.log('[AI] CLOUDFLARE_AI_TOKEN:', apiToken ? 'SET' : 'MISSING');
	console.log('[AI] CLOUDFLARE_API_TOKEN:', env.CLOUDFLARE_API_TOKEN ? 'SET' : 'MISSING');

	if (!accountId || !apiToken) {
		log.error('[AI] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN');
		return {
			success: false,
			error: 'AI service not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN.',
		};
	}

	// mcpClient / mcpEnabled / runnerInventory were resolved above (shared with
	// the Ollama path). Only the intent classifier is Workers-AI-path specific.
	const localRunnerIntent = detectLocalRunnerIntent(message);

	console.log('[AI] MCP enabled:', mcpEnabled);
	log.info(`[AI] MCP enabled: ${mcpEnabled}`);

	// Deterministic runner discovery path so visibility questions always hit tools.
	if (localRunnerIntent.isVisibilityQuery) {
		if (!mcpEnabled) {
			return {
				success: true,
				response:
					"I can't check local runners right now because MCP tools are not configured on this deployment (missing CLOUDFLARE_API_TOKEN).",
			};
		}

		if (!runnerInventory?.ok) {
			return {
				success: true,
				response: `I tried to check your local runners, but the lookup failed: ${runnerInventory?.error || 'unknown error'}`,
				toolsUsed: ['list_local_runners'],
			};
		}

		return {
			success: true,
			response: formatRunnerVisibilityResponse(runnerInventory.runners),
			toolsUsed: ['list_local_runners'],
		};
	}

	// Build system prompt with context including selected server and permissions
	const systemPrompt = buildSystemPrompt({
		managedGuilds,
		mcpEnabled,
		isSuperAdmin,
		selectedGuild,
		selectedGuildId,
		selectedGuildName,
		runnerInventory,
	});

	// Build initial messages
	const messages = [
		{ role: 'system', content: systemPrompt },
		...history.slice(-10).map((msg) => ({ role: msg.role, content: msg.content })),
		{ role: 'user', content: `[${userName}]: ${message}` },
	];

	try {
		// First AI call
		let aiResponse = await callAI(messages, env);
		console.log('[AI] Full initial response:', aiResponse);

		const toolsUsed = [];
		const MAX_TOOL_ITERATIONS = Math.max(
			1,
			Math.min(20, Math.trunc(Number(maxToolIterations) || 5))
		);
		let iteration = 0;

		// Tool call loop - keep processing until AI stops making tool calls or we hit the limit
		while (iteration < MAX_TOOL_ITERATIONS) {
			// Check if AI wants to use tools
			const toolCalls = parseToolCalls(aiResponse);
			console.log(
				`[AI] Iteration ${iteration + 1}: Parsed ${toolCalls.length} tool call(s)`,
				toolCalls.map((t) => t.tool)
			);

			if (toolCalls.length === 0 || !mcpEnabled) {
				// No more tool calls, we're done
				break;
			}

			console.log(`[AI] Processing ${toolCalls.length} tool call(s)`);

			// Execute the tools
			const results = await executeToolCalls(toolCalls, env, userId);
			console.log('[AI] Tool results:', JSON.stringify(results, null, 2));
			toolsUsed.push(...toolCalls.map((t) => t.tool));

			// Add the tool results to the conversation
			const toolResultsText = formatToolResults(results);

			// Add assistant response and tool results
			messages.push({ role: 'assistant', content: aiResponse });
			messages.push({
				role: 'user',
				content: `Here are the results from the tools you requested:\n\n${toolResultsText}\n\nBased on these results, either use more tools if needed, or provide a helpful response to the user.`,
			});

			// Get next response (may contain more tool calls or final answer)
			aiResponse = await callAI(messages, env);
			log.debug(
				`[AI] Response after iteration ${iteration + 1}:`,
				aiResponse.substring(0, 200)
			);

			iteration++;
		}

		if (iteration >= MAX_TOOL_ITERATIONS) {
			log.warn('[AI] Hit max tool iterations limit');
		}

		// Clean up response - remove tool blocks and related text for final output
		const cleanResponse = aiResponse
			.replace(/```tool\s*\n[\s\S]*?```/g, '') // ```tool blocks
			.replace(/```json\s*\n[\s\S]*?```/g, '') // ```json blocks
			.replace(/```\s*\n\{"tool"[\s\S]*?```/g, '') // ``` blocks with tool JSON
			.replace(/\{"tool"\s*:\s*"[^"]+"[^}]*\}/g, '') // Raw tool JSON
			.replace(/Please wait for the result\.*/gi, '') // "Please wait" text
			.replace(/Here's how to do it:\s*/gi, '') // Instructional text
			.replace(/This should return[^.]*\./gi, '') // "This should return" text
			.replace(/I can then provide[^.]*\./gi, '') // "I can then provide" text
			.replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
			.trim();

		return {
			success: true,
			response:
				cleanResponse ||
				'I processed your request but have no additional information to share.',
			toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
		};
	} catch (error) {
		log.error('[AI] Request failed:', error.message);
		return {
			success: false,
			error: `AI request failed: ${error.message}`,
		};
	}
}

/**
 * Check if AI features are enabled
 * @param {Object} env - Environment variables
 * @returns {boolean}
 */
export function isAIEnabled(env) {
	return Boolean(isOllamaSelected(env) || (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN));
}

/**
 * Check if MCP features are enabled
 * @param {Object} env - Environment variables
 * @returns {boolean}
 */
export function isMCPEnabled(env) {
	return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

export { detectLocalRunnerIntent, formatRunnerVisibilityResponse };

export { BASE_SYSTEM_PROMPT as SYSTEM_PROMPT, MCP_TOOLS };
