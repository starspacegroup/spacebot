/**
 * External API v1 - One automation
 *
 * PATCH /api/v1/automations/:id - Enable or disable an automation
 * Body: { "enabled": boolean }
 *
 * Requires scope: automations:write
 * Auth: Bearer <api_key>. The automation must belong to the key's own guild.
 * Same code path as the dashboard toggle ($lib/server/control-actions.js).
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { log } from '$lib/db/logger.js';
import { logApiKeyWrite, setAutomationEnabled } from '$lib/server/control-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request, platform, params }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'automations:write')) {
		return json({ error: 'Insufficient scope. Required: automations:write' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

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
		const result = await setAutomationEnabled(db, auth.guildId, params.id, body.enabled);
		if (!result.ok) {
			return json({ error: result.error }, { status: result.status });
		}
		const id = result.automation?.id ?? params.id;
		await logApiKeyWrite(
			db,
			auth,
			'API_AUTOMATION_TOGGLED',
			{ id, name: result.automation?.name },
			{ enabled: body.enabled }
		);
		return json({ success: true, guild_id: auth.guildId, id, enabled: body.enabled });
	} catch (error) {
		log.error('[API v1] Error toggling automation:', error);
		return json({ error: 'Failed to update automation' }, { status: 500 });
	}
}
