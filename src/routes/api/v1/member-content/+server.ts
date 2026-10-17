/**
 * External API v1 — the content members keep about themselves (`/about`)
 *
 * GET /api/v1/member-content
 * GET /api/v1/member-content?user_id=<id>
 * GET /api/v1/member-content?limit=50&offset=50
 *
 * Read-only. Plain text exactly as the member typed it: a caller that renders
 * it as HTML must escape it. A `user_id` that has set nothing is a 404.
 *
 * Requires scope: content:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getMemberContent, listMemberContent } from '$lib/server/member-content.js';
import { log } from '$lib/db/logger.js';

export async function GET({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'content:read')) {
		return json({ error: 'Insufficient scope. Required: content:read' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	try {
		const userId = (url.searchParams.get('user_id') || '').trim();
		if (userId) {
			const found = await getMemberContent(db, auth.guildId, userId);
			if (!found) return json({ error: 'Not found' }, { status: 404 });
			return json({ guild_id: auth.guildId, user_id: userId, ...found });
		}

		const limit = Math.min(
			Math.max(parseInt(url.searchParams.get('limit') || '', 10) || 100, 1),
			100
		);
		const offset = Math.max(parseInt(url.searchParams.get('offset') || '', 10) || 0, 0);
		const entries = await listMemberContent(db, auth.guildId, limit, offset);
		return json({ guild_id: auth.guildId, count: entries.length, limit, offset, entries });
	} catch (error) {
		log.error('[API v1] Error fetching member content:', error);
		return json({ error: 'Failed to fetch member content' }, { status: 500 });
	}
}
