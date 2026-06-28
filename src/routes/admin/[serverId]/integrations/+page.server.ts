import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import {
	getGuildIntegrations,
	getIntegrationById,
	enableGuildIntegration,
	disableGuildIntegration,
	updateGuildIntegrationConfig,
} from '$lib/db/integrations.js';
import { seedBuiltInIntegrations } from '$lib/integrations/registry.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { generateWebhookSecret } from '$lib/integrations/github.js';

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;

	const adminUserIds =
		platform?.env?.ADMIN_USER_IDS ||
		(typeof process !== 'undefined' ? process.env?.ADMIN_USER_IDS : '') ||
		'';

	const superAdminIdList = adminUserIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
	return superAdminIdList.includes(userId);
}

/**
 * Fire a lifecycle webhook (on_enable / on_disable) for an integration.
 * Fire-and-forget — failures are logged but don't block the action.
 */
async function fireLifecycleWebhook(db, integrationId, event, payload) {
	try {
		const integration = await getIntegrationById(db, integrationId);
		if (!integration) return;

		const manifest = integration.manifest;
		if (!manifest?.webhooks) return;

		const url =
			event === 'integration.enabled'
				? manifest.webhooks.on_enable
				: manifest.webhooks.on_disable;

		if (!url) return;

		log.info(`[Integrations] Firing ${event} webhook to ${url}`);

		fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-SpaceBot-Integration': integration.slug,
			},
			body: JSON.stringify({ event, ...payload }),
			signal: AbortSignal.timeout(10_000),
		}).catch((err) => {
			log.warn(
				`[Integrations] Lifecycle webhook failed for ${integration.slug}:`,
				err.message
			);
		});
	} catch (err) {
		log.warn(`[Integrations] Error firing lifecycle webhook:`, err);
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
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

	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
	if (!hasAccessToServer) {
		throw redirect(302, '/admin');
	}

	const guild = adminGuilds.find((g) => g.id === serverId);
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);

	if (!hasFullAdminAccess) {
		throw redirect(302, `/admin/${serverId}`);
	}

	const db = (platform as any)?.env?.DB;

	// Ensure built-in integrations are seeded
	if (db) {
		await seedBuiltInIntegrations(db);
	}

	const integrations = db ? await getGuildIntegrations(db, serverId) : [];

	// Only show integrations that have connected at least once (completed handshake).
	// Integrations in the catalog that never synced are hidden from guild admins.
	// Also pass through any that the guild has already enabled (edge case: was enabled
	// before this filter existed).
	const availableIntegrations = integrations.filter((i) => i.connected_at || i.guild_enabled);

	return {
		serverId,
		guild,
		integrations: availableIntegrations,
		hasFullAdminAccess,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	/**
	 * Enable an integration for this guild
	 */
	enableIntegration: async ({ request, cookies, platform, params }) => {
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
		const integrationId = parseInt(formData.get('integrationId') as string);

		if (!integrationId) {
			return fail(400, {
				success: false,
				message: 'Integration ID is required',
			});
		}

		log.info(`[Integrations] Enabling integration ${integrationId} for server ${serverId}`);

		// For the GitHub integration, auto-generate a webhook secret
		const integration = await getIntegrationById(db, integrationId);
		const config: Record<string, any> = {};
		if (integration?.slug === 'github') {
			config.webhook_secret = generateWebhookSecret();
		}

		const result = await enableGuildIntegration(db, serverId, integrationId, userId, config);

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		// Re-sync guild commands so integration commands get registered
		try {
			await syncGuildCommands(db, serverId, (platform as any)?.env);
		} catch (err) {
			log.error('[Integrations] Failed to sync commands after enable:', err);
		}

		// Fire lifecycle webhook (fire-and-forget)
		fireLifecycleWebhook(db, integrationId, 'integration.enabled', {
			guild_id: serverId,
			enabled_by: userId,
			config: {},
		});

		return { success: true, message: 'Integration enabled successfully' };
	},

	/**
	 * Disable an integration for this guild
	 */
	disableIntegration: async ({ request, cookies, platform, params }) => {
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
		const integrationId = parseInt(formData.get('integrationId') as string);

		if (!integrationId) {
			return fail(400, {
				success: false,
				message: 'Integration ID is required',
			});
		}

		log.info(`[Integrations] Disabling integration ${integrationId} for server ${serverId}`);

		const result = await disableGuildIntegration(db, serverId, integrationId);

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		// Re-sync guild commands so integration commands get removed
		try {
			await syncGuildCommands(db, serverId, (platform as any)?.env);
		} catch (err) {
			log.error('[Integrations] Failed to sync commands after disable:', err);
		}

		// Fire lifecycle webhook (fire-and-forget)
		fireLifecycleWebhook(db, integrationId, 'integration.disabled', {
			guild_id: serverId,
		});

		return { success: true, message: 'Integration disabled successfully' };
	},

	/**
	 * Update configuration for an enabled integration
	 */
	updateConfig: async ({ request, cookies, platform, params }) => {
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
		const integrationId = parseInt(formData.get('integrationId') as string);
		const configRaw = formData.get('config');

		if (!integrationId) {
			return fail(400, {
				success: false,
				message: 'Integration ID is required',
			});
		}

		let config;
		try {
			config = JSON.parse((configRaw as string) || '{}');
		} catch {
			return fail(400, { success: false, message: 'Invalid config JSON' });
		}

		log.info(
			`[Integrations] Updating config for integration ${integrationId} in server ${serverId}`
		);

		const result = await updateGuildIntegrationConfig(db, serverId, integrationId, config);

		if (!result.success) {
			return fail(400, { success: false, message: result.error });
		}

		return {
			success: true,
			message: 'Integration configuration updated successfully',
		};
	},
};
