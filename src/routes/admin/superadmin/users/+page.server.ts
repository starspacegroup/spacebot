import { redirect } from '@sveltejs/kit';
import { listUsers } from '$lib/db/users.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;

	const search = url.searchParams.get('search') || undefined;
	const page = parseInt(url.searchParams.get('page') || '1', 10);
	const limit = 50;
	const offset = (page - 1) * limit;

	const result = db
		? await listUsers(db, { search, limit, offset, sort: 'last_login_at', order: 'desc' })
		: { users: [], total: 0 };

	return {
		users: result.users,
		total: result.total,
		page,
		limit,
		search: search || '',
	};
}
