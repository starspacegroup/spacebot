import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import {
	getGuildApiKeys,
	createApiKey,
	revokeApiKey,
	deleteApiKey,
	API_KEY_SCOPES,
} from '$lib/db/api-keys.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	// Validate that serverId is a Discord snowflake
	if (!/^\d{17,20}$/.test(params.serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();
	const userId = cookies.get('discord_user_id');

	if (!userId) {
		throw redirect(302, '/login');
	}

	const serverId = params.serverId;
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];

	// Check access to this server
	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
	if (!hasAccessToServer) {
		throw redirect(302, '/admin');
	}

	// Get guild info
	const guild = adminGuilds.find((g) => g.id === serverId);

	// Require full admin access for API key management
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);
	if (!hasFullAdminAccess) {
		throw redirect(302, `/admin/${serverId}`);
	}

	// Load API keys from database
	const db = (platform as any)?.env?.DB;
	const apiKeys = db ? await getGuildApiKeys(db, serverId) : [];

	return {
		serverId,
		guild,
		apiKeys,
		availableScopes: API_KEY_SCOPES,
		hasFullAdminAccess,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	/**
	 * Create a new API key
	 */
	createApiKey: async ({ request, cookies, platform, params }) => {
		const userId = cookies.get('discord_user_id');
		const serverId = params.serverId;

		if (!userId) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}

		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { success: false, message: 'Database not available' });
		}

		const formData = await request.formData();
		const name = formData.get('keyName') as string | null;
		const description = formData.get('keyDescription') as string | null;
		const scopesRaw = formData.getAll('scopes');
		const expiresAt = formData.get('expiresAt') || null;

		if (!name?.trim()) {
			return fail(400, { success: false, message: 'API key name is required' });
		}

		if (!scopesRaw || scopesRaw.length === 0) {
			return fail(400, { success: false, message: 'At least one scope must be selected' });
		}

		log.info(`[ApiKeys] Creating API key for server ${serverId}:`, { name, scopes: scopesRaw });

		const result = await createApiKey(db, serverId, {
			name: name.trim(),
			description: description?.trim() || '',
			scopes: scopesRaw,
			created_by: userId,
			expires_at: expiresAt || null,
		});

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		return {
			success: true,
			message:
				"API key created successfully! Copy it now — you won't be able to see it again.",
			rawKey: result.rawKey,
		};
	},

	/**
	 * Revoke an API key (soft disable)
	 */
	revokeApiKey: async ({ request, cookies, platform, params }) => {
		const userId = cookies.get('discord_user_id');
		const serverId = params.serverId;

		if (!userId) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}

		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { success: false, message: 'Database not available' });
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId') as string);

		if (!keyId) {
			return fail(400, { success: false, message: 'API key ID is required' });
		}

		log.info(`[ApiKeys] Revoking API key ${keyId} for server ${serverId}`);

		const result = await revokeApiKey(db, serverId, keyId);

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		return { success: true, message: 'API key revoked successfully' };
	},

	/**
	 * Delete an API key permanently
	 */
	deleteApiKey: async ({ request, cookies, platform, params }) => {
		const userId = cookies.get('discord_user_id');
		const serverId = params.serverId;

		if (!userId) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}

		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { success: false, message: 'Database not available' });
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId') as string);

		if (!keyId) {
			return fail(400, { success: false, message: 'API key ID is required' });
		}

		log.info(`[ApiKeys] Deleting API key ${keyId} for server ${serverId}`);

		const result = await deleteApiKey(db, serverId, keyId);

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		return { success: true, message: 'API key deleted permanently' };
	},
};
