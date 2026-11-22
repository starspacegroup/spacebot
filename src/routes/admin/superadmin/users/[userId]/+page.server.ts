import { error, redirect } from '@sveltejs/kit';
import { getUser } from '$lib/db/users.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { serversOfUser } from '$lib/server/user-guilds.js';
import { errorFeed, userTimeline } from '$lib/server/superadmin-logs.js';
import { serverNames } from '$lib/server/superadmin-names.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, params, url }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) throw redirect(302, '/admin');
	const db = (platform as any)?.env?.DB;
	if (!db || !/^\d{1,25}$/.test(params.userId)) throw error(404, 'No such user');

	const person = await getUser(db, params.userId);
	if (!person) throw error(404, 'No such user');

	const hours = url.searchParams.get('hours') ?? undefined;
	const [servers, timeline, errors] = await Promise.all([
		serversOfUser(db, params.userId),
		userTimeline(db, params.userId, { hours: hours as any, limit: 60 }),
		errorFeed(db, { userId: params.userId, hours: hours as any, limit: 20 }),
	]);
	const names = await serverNames(db, [
		...servers.map((s) => s.guild_id),
		...timeline.map((r) => r.guild_id),
		...errors.map((r) => r.guild_id),
	]);
	return {
		person: {
			id: person.id,
			username: person.username,
			global_name: person.global_name,
			avatar: person.avatar,
			last_login_at: person.last_login_at,
			login_count: person.login_count,
			created_at: person.created_at,
			banned: Boolean(person.banned),
			is_superadmin: Boolean(person.is_superadmin),
			notes: person.notes,
		},
		servers,
		timeline,
		errors,
		names,
		hours: Number(hours) || 168,
	};
}
