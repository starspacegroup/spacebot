/**
 * Discord bot command definitions
 * Register these commands using the Discord API
 */

import { log } from '../log.js';
import {
	BUILT_IN_GUILD_ID,
	ensureBuiltInCommands,
	getBuiltInCommandsForGuild,
	getGuildCommands,
	markCommandRegistered,
	toDiscordCommand,
} from '../db/commands.js';
import { getEnabledGuildIntegrations } from '../db/integrations.js';
import { getIntegrationCommands } from '../integrations/registry.js';
import { buildStartCommand } from './start-command.js';

/**
 * Hardcoded built-in command definitions for initial registration (before DB is available).
 * After DB seeding, built-in commands are read from the database.
 */
export const commands = [
	{
		name: 'ping',
		description: 'Check if the bot is responsive',
		type: 1, // CHAT_INPUT
	},
	{
		name: 'info',
		description: 'View bot information and statistics',
		type: 1, // CHAT_INPUT
	},
	{
		name: 'help',
		description: 'List the commands you can use here',
		type: 1, // CHAT_INPUT
		dm_permission: true,
	},
	{
		name: 'stats',
		description: 'Show server stats charts and voice leaderboards',
		type: 1, // CHAT_INPUT
		options: [
			{
				name: 'type',
				description: 'Which stats to show',
				type: 3, // STRING
				required: false,
				choices: [
					{ name: 'Voice Leaderboard', value: 'voice_leaderboard' },
					{ name: 'Voice Time', value: 'voice_time' },
					{ name: 'Voice Users', value: 'voice_users' },
					{ name: 'Voice Peak', value: 'voice_peak' },
					{ name: 'Member Count', value: 'member_count' },
					{ name: 'Member Growth', value: 'member_growth' },
					{ name: 'Member Joins', value: 'member_joins' },
					{ name: 'Member Leaves', value: 'member_leaves' },
					{ name: 'Member Net Change', value: 'member_net_change' },
					{ name: 'Message Count', value: 'message_count' },
					{ name: 'Message Authors', value: 'message_users' },
				],
			},
			{
				name: 'period',
				description: 'Time period',
				type: 3, // STRING
				required: false,
				choices: [
					{ name: 'Last 30 days', value: '30d' },
					{ name: 'Last 7 days', value: '7d' },
				],
			},
		],
	},
];

/** Application command type for the Activity launcher Discord creates for us. */
export const ENTRY_POINT_COMMAND_TYPE = 4;

/**
 * The app's Entry Point commands, as Discord returned them, shaped to go back in
 * a bulk overwrite. Empty when Activities are not enabled or the read fails —
 * a failed read must not stop a registration that would have worked before.
 */
export async function getEntryPointCommands(clientId, botToken, f: typeof fetch = fetch) {
	try {
		const res = await f(`https://discord.com/api/v10/applications/${clientId}/commands`, {
			headers: { Authorization: `Bot ${botToken}` },
		});
		if (!res.ok) return [];
		const existing: any[] = await res.json();
		return existing
			.filter((c) => c?.type === ENTRY_POINT_COMMAND_TYPE)
			.map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				type: c.type,
				handler: c.handler,
				integration_types: c.integration_types,
				contexts: c.contexts,
			}));
	} catch (error) {
		log.warn('registerCommands: could not read Entry Point commands:', error);
		return [];
	}
}

/**
 * Register commands with Discord
 * Run this script to deploy commands to Discord
 *
 * Usage:
 * DISCORD_CLIENT_ID=xxx DISCORD_BOT_TOKEN=xxx bun run register-commands
 *
 * For instant guild-specific registration (recommended for testing):
 * DISCORD_CLIENT_ID=xxx DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx bun run register-commands
 */
export async function registerCommands(clientId, botToken, guildId = null) {
	// Guild commands update instantly, global commands can take up to an hour
	const url = guildId
		? `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`
		: `https://discord.com/api/v10/applications/${clientId}/commands`;

	try {
		// A global PUT replaces every global command. Once Activities are enabled
		// the app owns an Entry Point command (type 4) that Discord created, and an
		// overwrite that leaves it out is refused. Read it back and keep it.
		const body: any[] = [...commands];
		if (!guildId) body.push(...(await getEntryPointCommands(clientId, botToken)));

		const response = await fetch(url, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bot ${botToken}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to register commands: ${error}`);
		}

		const data = await response.json();
		log.info('Successfully registered commands:', data);
		return data;
	} catch (error) {
		log.error('Error registering commands:', error);
		throw error;
	}
}

/**
 * Every command a guild has, from all three sources.
 *
 * `syncGuildCommands` registers exactly this set with Discord and `/help`
 * lists exactly this set back to a member, so they read it from one place. The
 * alternative — each assembling its own — is how a command comes to exist in
 * Discord and not in the help, or the other way round.
 *
 * Integration commands are included whatever the integration's status, which
 * matches registration: a command stays available while its integration is
 * briefly offline, and the interaction handler explains itself if it cannot
 * run.
 */
export async function collectGuildCommands(db, guildId) {
	await ensureBuiltInCommands(db);

	const builtIn = (await getBuiltInCommandsForGuild(db, guildId)).filter((cmd) => cmd.enabled);
	const custom = await getGuildCommands(db, guildId, { enabledOnly: true });

	const integration = [];
	try {
		for (const enabled of await getEnabledGuildIntegrations(db, guildId)) {
			integration.push(...getIntegrationCommands(enabled));
		}
	} catch (error) {
		// A broken integration must not take the command list with it.
		log.warn('collectGuildCommands: Failed to load integration commands:', error);
	}

	return { builtIn, custom, integration };
}

/**
 * Sync all guild commands to Discord.
 * Performs a bulk PUT of built-in + enabled custom commands, then updates DB registration state.
 * Call this after any command CRUD operation so users never need to manually sync.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} env - Platform env with DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID
 * @returns {Promise<{success: boolean, registered?: number, error?: string}>}
 */
export async function syncGuildCommands(db, guildId, env) {
	const botToken = env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const clientId = env?.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

	if (!botToken || !clientId) {
		log.warn('syncGuildCommands: Bot configuration not available, skipping sync');
		return { success: false, error: 'Bot configuration not available' };
	}

	if (!db) {
		log.warn('syncGuildCommands: Database not available, skipping sync');
		return { success: false, error: 'Database not available' };
	}

	try {
		const { allCommands, discordCommands, integrationCommands } =
			await buildGuildCommandPayload(db, guildId);

		if (integrationCommands.length > 0) {
			log.info(
				`syncGuildCommands: Adding ${integrationCommands.length} integration command(s) for guild ${guildId}`
			);
		}

		// Bulk-overwrite guild commands (PUT replaces the entire set)
		const url = `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;

		const response = await fetch(url, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bot ${botToken}`,
			},
			body: JSON.stringify(allCommands),
		});

		if (!response.ok) {
			const error = await response.text();
			log.error('syncGuildCommands: Discord registration error:', error);
			return { success: false, error: `Discord API error: ${error}` };
		}

		const registeredCommands = await response.json();

		// Update database with Discord command IDs
		for (const dbCommand of discordCommands) {
			const registered = registeredCommands.find((rc) => rc.name === dbCommand.name);
			if (registered) {
				await markCommandRegistered(db, dbCommand._dbId, registered.id);
			}
		}

		await recordCommandSync(db, guildId, await hashCommandPayload(allCommands));

		log.info(
			`syncGuildCommands: Synced ${registeredCommands.length} commands for guild ${guildId}`
		);
		return { success: true, registered: registeredCommands.length };
	} catch (error) {
		log.error('syncGuildCommands error:', error);
		return { success: false, error: error.message || String(error) };
	}
}

/**
 * The exact command list a guild should have in Discord, and the pieces it is
 * built from. `syncGuildCommands` sends it; the sweep rebuilds it to see
 * whether what Discord holds is stale. One builder, so the two cannot disagree.
 */
export async function buildGuildCommandPayload(db, guildId) {
	const {
		builtIn: builtInCommands,
		custom: customCommands,
		integration: integrationCommands,
	} = await collectGuildCommands(db, guildId);

	const builtInDiscord = builtInCommands.map((cmd) => toDiscordCommand(cmd)).flat();
	// `/start` is built from the activity commands this server has on.
	const start = buildStartCommand(builtInDiscord);
	if (start) builtInDiscord.push(start);

	// Convert to Discord format, tracking DB IDs
	const discordCommands = [];
	for (const cmd of customCommands) {
		const result = toDiscordCommand(cmd);
		if (Array.isArray(result)) {
			for (const discordCmd of result) {
				discordCommands.push({ ...discordCmd, _dbId: cmd.id });
			}
		} else {
			discordCommands.push({ ...result, _dbId: cmd.id });
		}
	}

	// Combine built-in (from DB), custom, and integration commands
	const allCommands = [
		...builtInDiscord,
		...discordCommands.map(({ _dbId, ...cmd }) => cmd),
		...integrationCommands,
	];

	return { allCommands, discordCommands, integrationCommands };
}

/** SHA-256 of the command list, hex. Order matters: it is the order we send. */
export async function hashCommandPayload(allCommands) {
	const bytes = new TextEncoder().encode(JSON.stringify(allCommands));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function recordCommandSync(db, guildId, hash) {
	try {
		await db
			.prepare(
				`INSERT INTO guild_command_sync (guild_id, payload_hash, synced_at, checked_at, attempted_at, last_error)
         VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'), NULL)
         ON CONFLICT(guild_id) DO UPDATE SET
           payload_hash = excluded.payload_hash,
           synced_at = excluded.synced_at,
           checked_at = excluded.checked_at,
           attempted_at = excluded.attempted_at,
           last_error = NULL`
			)
			.bind(guildId, hash)
			.run();
	} catch (error) {
		// Losing the record only means one extra sync later.
		log.warn('recordCommandSync: could not save the sync record:', error);
	}
}

/** How long a failed sync waits before the sweep tries that server again. */
export const COMMAND_SYNC_RETRY_MINUTES = 30;
/** Servers the sweep looks at per run. Each look is a few reads, a sync is one Discord call. */
export const COMMAND_SYNC_BATCH = 10;

/**
 * Keep every server's slash commands in step with the code, without anyone
 * running `register-commands`.
 *
 * Each run takes the servers looked at longest ago, rebuilds the list each
 * should have, and syncs the ones whose list differs from the last one sent
 * (or that were never sent). A server whose sync failed waits
 * COMMAND_SYNC_RETRY_MINUTES, so one the bot has left does not fail every
 * minute. A deploy that changes any command reaches every server within a few
 * runs.
 */
export async function sweepCommandSync(db, env, { limit = COMMAND_SYNC_BATCH } = {}) {
	const result = { checked: 0, synced: 0, failed: 0, current: 0 };
	if (!db) return result;

	const rows = await db
		.prepare(
			`SELECT g.guild_id
         FROM (
           SELECT guild_id FROM commands WHERE guild_id != ?
           UNION SELECT guild_id FROM built_in_command_overrides
           UNION SELECT guild_id FROM guild_integrations
           UNION SELECT guild_id FROM guild_command_sync
         ) g
         LEFT JOIN guild_command_sync s ON s.guild_id = g.guild_id
         WHERE g.guild_id IS NOT NULL
           AND (s.attempted_at IS NULL
                OR s.last_error IS NULL
                OR s.attempted_at <= datetime('now', ?))
         ORDER BY s.checked_at IS NOT NULL, s.checked_at
         LIMIT ?`
		)
		.bind(BUILT_IN_GUILD_ID, `-${COMMAND_SYNC_RETRY_MINUTES} minutes`, limit)
		.all();

	for (const { guild_id: guildId } of rows?.results || []) {
		result.checked++;
		try {
			const { allCommands } = await buildGuildCommandPayload(db, guildId);
			const hash = await hashCommandPayload(allCommands);
			const known = await db
				.prepare('SELECT payload_hash FROM guild_command_sync WHERE guild_id = ?')
				.bind(guildId)
				.first();

			if (known?.payload_hash === hash) {
				await db
					.prepare(
						"UPDATE guild_command_sync SET checked_at = datetime('now') WHERE guild_id = ?"
					)
					.bind(guildId)
					.run();
				result.current++;
				continue;
			}

			const synced = await syncGuildCommands(db, guildId, env);
			if (synced.success) {
				result.synced++;
			} else {
				result.failed++;
				await db
					.prepare(
						`INSERT INTO guild_command_sync (guild_id, checked_at, attempted_at, last_error)
             VALUES (?, datetime('now'), datetime('now'), ?)
             ON CONFLICT(guild_id) DO UPDATE SET
               checked_at = excluded.checked_at,
               attempted_at = excluded.attempted_at,
               last_error = excluded.last_error`
					)
					.bind(guildId, String(synced.error || 'unknown').slice(0, 500))
					.run();
			}
		} catch (error) {
			result.failed++;
			log.warn(`sweepCommandSync: guild ${guildId} failed:`, error);
		}
	}

	if (result.synced || result.failed) {
		log.info(
			`sweepCommandSync: ${result.synced} synced, ${result.failed} failed, ${result.current} current`
		);
	}
	return result;
}
