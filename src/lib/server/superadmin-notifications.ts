import { getGlobalSetting, setGlobalSetting } from '$lib/db/global-settings.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { log } from '$lib/log.js';

export const FIRST_LOGIN_DM_SETTING_KEY = 'superadmin_first_login_dm_enabled';

function getAdminUserIds(platform) {
	// Bare `process` is a ReferenceError on the Workers runtime; guard it the
	// same way superadmin-guard.ts does.
	const adminUserIds =
		platform?.env?.ADMIN_USER_IDS ||
		(typeof process !== 'undefined' ? process.env?.ADMIN_USER_IDS : '') ||
		'';
	return adminUserIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}

function formatUserLabel(user) {
	if (!user) return 'Unknown user';

	if (user.global_name && user.global_name !== user.username) {
		return `${user.global_name} (@${user.username})`;
	}

	return user.username ? `@${user.username}` : user.id;
}

export async function getFirstLoginDmEnabled(db) {
	const value = await getGlobalSetting(db, FIRST_LOGIN_DM_SETTING_KEY, 'false');
	return value === 'true';
}

export async function setFirstLoginDmEnabled(db, enabled) {
	return setGlobalSetting(db, FIRST_LOGIN_DM_SETTING_KEY, enabled ? 'true' : 'false');
}

export async function notifySuperAdminsOfFirstLogin(platform, user) {
	const db = platform?.env?.DB;
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	if (!db || !botToken) {
		return { success: false, skipped: true, reason: 'missing_dependencies' };
	}

	const enabled = await getFirstLoginDmEnabled(db);
	if (!enabled) {
		return { success: true, skipped: true, reason: 'disabled' };
	}

	const adminUserIds = getAdminUserIds(platform);
	if (adminUserIds.length === 0) {
		return { success: false, skipped: true, reason: 'no_superadmins' };
	}

	const client = createDiscordRestClient(botToken);
	const signedInAtUnix = Math.floor(Date.now() / 1000);
	const message = [
		'New SpaceBot user sign-in detected.',
		`User: ${formatUserLabel(user)}`,
		`User ID: ${user.id}`,
		`Signed in: <t:${signedInAtUnix}:F>`,
	].join('\n');

	const results = await Promise.allSettled(
		adminUserIds.map(async (adminUserId) => {
			const adminUser = await client.users.fetch(adminUserId);
			await adminUser.send(message);
			return adminUserId;
		})
	);

	const deliveredTo = [];
	const failed = [];

	results.forEach((result, index) => {
		const adminUserId = adminUserIds[index];
		if (result.status === 'fulfilled') {
			deliveredTo.push(result.value);
			return;
		}

		failed.push({
			adminUserId,
			error: result.reason?.message || String(result.reason),
		});
	});

	if (failed.length > 0) {
		log.warn('[SuperadminNotifications] Failed to deliver some first-login DMs:', failed);
	}

	return {
		success: failed.length === 0,
		deliveredTo,
		failed,
	};
}
