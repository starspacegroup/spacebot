/**
 * External API v1 - Commands
 *
 * GET /api/v1/commands - Slash commands available in the authenticated guild
 * GET /api/v1/commands?built_in=only | ?built_in=exclude
 *
 * Both halves of what a member can actually type: SpaceBot's built-in commands
 * (`/ping`, `/help`, `/stats`, …) and the commands this guild has defined for
 * itself. Built-ins live under the reserved `__built_in__` guild with optional
 * per-guild overrides, so a query filtered to `auth.guildId` alone misses
 * exactly the commands a newcomer is looking for — this endpoint used to do
 * that, and returned an empty list on a server with no custom commands.
 *
 * Built-ins sort first. `is_built_in` distinguishes them for a caller that
 * wants to draw them apart.
 *
 * Requires scope: commands:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getBuiltInCommandsForGuild, getGuildCommands } from '$lib/db/commands.js';
import { log } from '$lib/db/logger.js';

const byName = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''));

export async function GET({ request, platform, url }) {
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
		const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
		const offset = parseInt(url.searchParams.get('offset') || '0');
		const builtIn = (url.searchParams.get('built_in') || '').trim().toLowerCase();

		// Both sets are fetched whole and paginated together. Paginating them
		// separately in SQL would make `limit` mean something different
		// depending on which half a page happened to land in.
		const [builtInCommands, guildCommands] = await Promise.all([
			builtIn === 'exclude'
				? Promise.resolve([])
				: getBuiltInCommandsForGuild(db, auth.guildId),
			builtIn === 'only' ? Promise.resolve([]) : getGuildCommands(db, auth.guildId),
		]);

		const all = [
			...(builtInCommands || []).sort(byName),
			...(guildCommands || []).sort(byName),
		];

		return json({
			guild_id: auth.guildId,
			commands: all.slice(offset, offset + limit),
			total: all.length,
			limit,
			offset,
		});
	} catch (error) {
		log.error('[API v1] Error fetching commands:', error);
		return json({ error: 'Failed to fetch commands' }, { status: 500 });
	}
}
