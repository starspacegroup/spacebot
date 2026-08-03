/**
 * Shared admin gate for the listing-assist endpoints.
 *
 * Both endpoints act on a guild the caller claims to administer — one spends AI
 * budget, the other creates a real Discord invite — so they use the same bar as
 * the settings page that hosts them: superadmin, or full Administrator on that
 * guild. MANAGE_GUILD is deliberately not enough, matching
 * `admin/[serverId]/settings`.
 */

import { json } from '@sveltejs/kit';
import { hasFullAdminPermission, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { getEnv } from '$lib/env.js';

function isSuperAdmin(userId: string | undefined, platform: any): boolean {
	if (!userId) return false;
	// getEnv, not a raw `process.env` fallback: bare `process` is a ReferenceError
	// in the Workers runtime whenever the platform binding is absent.
	const ids = getEnv('ADMIN_USER_IDS', platform) || '';
	return String(ids)
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

/**
 * Returns a Response to short-circuit on denial, or null when authorized.
 */
export async function requireListingAdmin({
	params,
	cookies,
	platform,
}: {
	params: { serverId?: string };
	cookies: any;
	platform: any;
}): Promise<Response | null> {
	const serverId = params.serverId || '';
	if (!/^\d{17,20}$/.test(serverId)) {
		return json({ error: 'Invalid server id' }, { status: 400 });
	}

	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

	if (isSuperAdmin(userId, platform)) return null;

	const verification = await verifyGuildAdmin(
		serverId,
		cookies.get('discord_access_token'),
		cookies
	);
	if (!verification?.authorized || !hasFullAdminPermission(verification.guild)) {
		return json(
			{ error: 'You do not have permission to manage this server.' },
			{ status: 403 }
		);
	}
	return null;
}
