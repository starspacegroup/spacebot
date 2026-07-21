import { redirect } from '@sveltejs/kit';
import { listIntegrations } from '$lib/db/integrations.js';
import { seedBuiltInIntegrations, usesIntegrationTokenAuth } from '$lib/integrations/registry.js';

function checkIsSuperAdmin(userId: string | undefined, platform: any): boolean {
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

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;
	if (db) {
		try {
			await seedBuiltInIntegrations(db);
		} catch {
			// non-fatal — built-ins seed lazily elsewhere too
		}
	}

	const all = db ? await listIntegrations(db) : [];
	// Only the token-authenticated (external) integrations are managed here.
	const integrations = all.filter(usesIntegrationTokenAuth);

	return { integrations };
}
