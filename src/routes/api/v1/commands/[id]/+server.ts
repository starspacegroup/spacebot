/**
 * External API v1 - One slash command
 *
 * PATCH /api/v1/commands/:id - Enable or disable a guild slash command
 * Body: { "enabled": boolean }
 *
 * Requires scope: commands:write
 * Auth: Bearer <api_key>. The command must belong to the key's own guild.
 * A built-in command is toggled as this guild's override, as on the dashboard
 * Commands page; the shared built-in row is never touched.
 * Same code path as the dashboard toggle ($lib/server/control-actions.js),
 * including the sync to Discord.
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { log } from '$lib/db/logger.js';
import { logApiKeyWrite, setCommandEnabled } from '$lib/server/control-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request, platform, params }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'commands:write')) {
		return json({ error: 'Insufficient scope. Required: commands:write' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	if (!/^\d+$/.test(params.id)) {
		return json({ error: 'Command id must be a number' }, { status: 400 });
	}
	const id = parseInt(params.id);

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body?.enabled !== 'boolean') {
		return json({ error: 'Body must be { enabled: boolean }' }, { status: 400 });
	}

	try {
		const result = await setCommandEnabled(
			db,
			(platform as any)?.env,
			auth.guildId,
			id,
			body.enabled
		);
		if (!result.ok) {
			return json({ error: result.error }, { status: result.status });
		}
		await logApiKeyWrite(
			db,
			auth,
			'API_COMMAND_TOGGLED',
			{ id, name: result.command?.name },
			{ enabled: body.enabled }
		);
		return json({ success: true, guild_id: auth.guildId, id, enabled: body.enabled });
	} catch (error) {
		log.error('[API v1] Error toggling command:', error);
		return json({ error: 'Failed to update command' }, { status: 500 });
	}
}
