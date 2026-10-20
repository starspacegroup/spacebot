/**
 * External API v1 - Command permissions
 *
 * GET /api/v1/commands/permissions - which SpaceBot slash commands a regular
 * member (only @everyone) can actually run in the authenticated guild.
 *
 * Combines SpaceBot's config (enabled, default_member_permissions, access
 * rules) with Discord's registered commands and the guild's command
 * permission overrides (Server Settings > Integrations). If Discord cannot be
 * reached, SpaceBot-only data is returned with `discord_error` set and every
 * `everyone_can_use` false, since registration is unknown.
 *
 * Requires scope: commands:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getBuiltInCommandsForGuild, getGuildCommands } from '$lib/db/commands.js';
import { getEnv } from '$lib/env.js';
import { log } from '$lib/db/logger.js';
import {
	resolveCommandEveryoneAccess,
	type DiscordCommandPermissions,
	type RegisteredCommand,
} from '$lib/discord/command-everyone-access.js';

const DISCORD_API = 'https://discord.com/api/v10';

async function discordGet<T>(path: string, token: string): Promise<T> {
	const response = await fetch(`${DISCORD_API}${path}`, {
		headers: { Authorization: `Bot ${token}` },
	});
	if (!response.ok) {
		throw new Error(`Discord ${response.status} on ${path.replace(/\d{5,}/g, ':id')}`);
	}
	return response.json() as Promise<T>;
}

async function loadDiscordState(guildId: string, platform: unknown) {
	const token = getEnv('DISCORD_BOT_TOKEN', platform);
	const applicationId = getEnv('DISCORD_CLIENT_ID', platform);
	if (!token || !applicationId) {
		return {
			applicationId: applicationId ?? '',
			registered: null,
			permissions: null,
			error: 'DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not configured',
		};
	}
	try {
		const [guildCommands, globalCommands, permissions] = await Promise.all([
			discordGet<RegisteredCommand[]>(
				`/applications/${applicationId}/guilds/${guildId}/commands`,
				token
			),
			discordGet<RegisteredCommand[]>(`/applications/${applicationId}/commands`, token),
			discordGet<DiscordCommandPermissions[]>(
				`/applications/${applicationId}/guilds/${guildId}/commands/permissions`,
				token
			),
		]);
		return {
			applicationId,
			registered: [...globalCommands, ...guildCommands],
			permissions,
			error: null,
		};
	} catch (error) {
		return {
			applicationId,
			registered: null,
			permissions: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function GET({ request, platform }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'commands:read')) {
		return json({ error: 'Insufficient scope. Required: commands:read' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	try {
		const [builtInCommands, guildCommands, discord] = await Promise.all([
			getBuiltInCommandsForGuild(db, auth.guildId),
			getGuildCommands(db, auth.guildId),
			loadDiscordState(auth.guildId, platform),
		]);

		if (discord.error) {
			log.warn('[API v1] Discord command permissions unavailable:', discord.error);
		}

		const byName = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
		const commands = resolveCommandEveryoneAccess({
			guildId: auth.guildId,
			applicationId: discord.applicationId,
			commands: [
				...(builtInCommands || []).sort(byName),
				...(guildCommands || []).sort(byName),
			],
			registered: discord.registered,
			permissions: discord.permissions,
		});

		return json({
			guild_id: auth.guildId,
			application_id: discord.applicationId || null,
			discord_error: discord.error,
			commands,
			total: commands.length,
		});
	} catch (error) {
		log.error('[API v1] Error resolving command permissions:', error);
		return json({ error: 'Failed to resolve command permissions' }, { status: 500 });
	}
}
