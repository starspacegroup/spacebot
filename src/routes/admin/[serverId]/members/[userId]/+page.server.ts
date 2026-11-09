import { redirect, error } from '@sveltejs/kit';
import { getMemberAdminProfile } from '$lib/db/member-admin-profile.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** Windows the page offers. Raw rows are kept 90 days, so nothing longer would be true. */
const DAY_CHOICES = [7, 30, 90];

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, cookies, platform, parent, url }) {
	const { serverId, userId } = params;

	if (!/^\d{17,20}$/.test(serverId)) throw redirect(302, '/admin');
	if (!/^\d{5,20}$/.test(userId)) throw error(404, 'Member not found');

	const parentData = await parent();
	if (!parentData.isLoggedIn || !parentData.user) throw redirect(302, '/login');

	// Same rule as the statistics page: a server admin, or a superadmin.
	const isSuperAdmin = checkIsSuperAdmin(cookies.get('discord_user_id'), platform);
	const adminGuilds = parentData.adminGuilds || [];
	if (!isSuperAdmin && !adminGuilds.some((g) => g.id === serverId)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;
	if (!db) throw error(503, 'Database not available');

	const asked = Number.parseInt(url.searchParams.get('days') || '30', 10);
	const days = DAY_CHOICES.includes(asked) ? asked : 30;
	const profile = await getMemberAdminProfile(db, serverId, userId, days);

	return {
		serverId,
		guild: adminGuilds.find((g) => g.id === serverId) || null,
		profile,
		dayChoices: DAY_CHOICES,
		timezone: parentData.timezone || null,
	};
}
