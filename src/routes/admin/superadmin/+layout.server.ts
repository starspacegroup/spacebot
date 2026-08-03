import { redirect } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	return {
		isSuperAdmin: true,
	};
}
