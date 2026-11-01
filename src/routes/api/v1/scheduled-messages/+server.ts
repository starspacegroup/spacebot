/**
 * External API v1 - Scheduled messages
 *
 * POST /api/v1/scheduled-messages - Schedule a channel message
 * Body: { "channel_id": string, "content": string, "send_at": ISO 8601 string }
 *
 * Requires scope: messages:write
 * Auth: Bearer <api_key>. The channel must belong to the key's own guild.
 * Stored with createScheduledMessage and sent by the existing scheduled-messages
 * cron, the same machinery automation send_later uses.
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { log } from '$lib/db/logger.js';
import { logApiKeyWrite, scheduleChannelMessage } from '$lib/server/control-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'messages:write')) {
		return json({ error: 'Insufficient scope. Required: messages:write' }, { status: 403 });
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

	try {
		const result = await scheduleChannelMessage(db, auth.guildId, {
			channel_id: body?.channel_id,
			content: body?.content,
			send_at: body?.send_at,
			created_by: `api_key:${auth.keyId}`,
		});
		if (!result.ok) {
			return json({ error: result.error }, { status: result.status });
		}
		await logApiKeyWrite(
			db,
			auth,
			'API_MESSAGE_SCHEDULED',
			{ id: result.id, channel_id: body.channel_id },
			{ scheduled_message_id: result.id, send_at: result.send_at }
		);
		return json(
			{ success: true, guild_id: auth.guildId, id: result.id, send_at: result.send_at },
			{ status: 201 }
		);
	} catch (error) {
		log.error('[API v1] Error scheduling message:', error);
		return json({ error: 'Failed to schedule message' }, { status: 500 });
	}
}
