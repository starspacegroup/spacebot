/**
 * Superadmin: set an integration's official guild
 *
 * POST /api/integrations/official-guild — { integrationId, guildId }
 *   Set (or clear, with guildId: null) the guild that receives an integration's
 *   platform-wide events (e.g. AgapeVerse poem_created / account_created).
 *
 * Superadmin only (checked via ADMIN_USER_IDS).
 */

import { json } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { setIntegrationOfficialGuild } from '$lib/db/integrations.js';

function isSuperAdmin(cookies: any, platform: any) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return false;

	const adminUserIds =
		(platform as any)?.env?.ADMIN_USER_IDS ||
		(typeof process !== 'undefined' ? process.env?.ADMIN_USER_IDS : '') ||
		'';

	return adminUserIds
		.split(',')
		.map((id: string) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
	if (!isSuperAdmin(cookies, platform)) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { integrationId, guildId } = body;
	if (!integrationId) {
		return json({ error: 'integrationId is required' }, { status: 400 });
	}

	// guildId may be null/empty to clear. If provided, it must be a snowflake.
	if (guildId && !/^\d{17,20}$/.test(String(guildId))) {
		return json({ error: 'guildId must be a Discord snowflake' }, { status: 400 });
	}

	const result = await setIntegrationOfficialGuild(db, integrationId, guildId || null);
	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	log.info(
		`[Superadmin] Set official guild for integration ${integrationId} → ${guildId || 'none'}`
	);

	return json({ success: true });
}
