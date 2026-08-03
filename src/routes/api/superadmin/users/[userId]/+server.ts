/**
 * Superadmin Single User API
 *
 * GET    /api/superadmin/users/[userId] - Get user details
 * PATCH  /api/superadmin/users/[userId] - Update user
 * DELETE /api/superadmin/users/[userId] - Delete user
 *
 * Superadmin access only.
 */

import { json } from '@sveltejs/kit';
import { getUser, updateUser, deleteUser } from '$lib/db/users.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const user = await getUser(db, params.userId);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	return json({ user });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ cookies, platform, params, request }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json();
	const result = await updateUser(db, params.userId, body);

	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	const user = await getUser(db, params.userId);
	return json({ success: true, user });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const result = await deleteUser(db, params.userId);
	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	return json({ success: true });
}
