/**
 * Authorization for SvelteKit form actions (security review 2026-10-20, #5).
 *
 * Page loaders checked guild/superadmin access, but actions are separately
 * addressable POSTs and many repeated nothing. This guard runs in
 * hooks.server.ts for every non-GET request to an admin page, so an action can
 * no longer be reached without the same check its loader makes:
 *
 *   /admin/superadmin/**   → superadmin
 *   /admin/<guildId>/**    → superadmin, or Discord ADMINISTRATOR/MANAGE_GUILD
 *                            on that guild (actions may demand more themselves)
 *   /admin                 → signed-in (its actions check superadmin)
 *
 * /api/** routes authorize themselves and are not covered here.
 */

import { checkIsSuperAdmin } from './superadmin-guard.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const GUILD_PATH = /^\/admin\/(\d{17,20})(?:\/|$)/;

function deny(status: number, message: string): Response {
	return new Response(JSON.stringify({ type: 'error', error: { message } }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

export async function authorizePageMutation({
	method,
	pathname,
	userId,
	cookies,
	platform,
}: {
	method: string;
	pathname: string;
	userId: string | null;
	cookies: import('@sveltejs/kit').Cookies;
	platform: unknown;
}): Promise<Response | null> {
	if (SAFE_METHODS.has(method.toUpperCase())) return null;
	if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return null;

	if (!userId) return deny(401, 'Not authenticated');
	if (checkIsSuperAdmin(userId, platform)) return null;

	if (pathname.startsWith('/admin/superadmin')) return deny(403, 'Superadmin access required');

	const guildMatch = GUILD_PATH.exec(pathname);
	if (guildMatch) {
		const verification = await verifyGuildAdmin(
			guildMatch[1],
			cookies.get('discord_access_token'),
			cookies
		);
		if (!verification?.authorized)
			return deny(403, 'You do not have permission to manage this server');
		return null;
	}

	if (pathname === '/admin') return null;
	return deny(403, 'Forbidden');
}
