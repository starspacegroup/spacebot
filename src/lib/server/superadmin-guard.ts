/**
 * Shared auth guards for superadmin APIs.
 *
 * Previously copy-pasted into every superadmin endpoint; import from here
 * instead.
 */

export function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds =
		(platform as { env?: Record<string, string> })?.env?.ADMIN_USER_IDS ||
		process.env.ADMIN_USER_IDS ||
		'';
	return adminUserIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

/** Bearer CRON_SECRET / INTERNAL_API_KEY — used by the orchestrator worker
 * and other internal callers. */
export function checkBearerAuth(request, platform) {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) return false;

	const env = (platform as { env?: Record<string, string> })?.env;
	const cronSecret = env?.CRON_SECRET || process.env.CRON_SECRET;
	if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

	const internalKey = env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
	if (internalKey && authHeader === `Bearer ${internalKey}`) return true;

	return false;
}

/** Bearer key OR superadmin session cookie. */
export function checkInternalOrSuperAdmin({ request, cookies, platform }) {
	if (checkBearerAuth(request, platform)) return true;
	return checkIsSuperAdmin(cookies.get('discord_user_id'), platform);
}
