/**
 * Shared auth guards for superadmin APIs.
 *
 * Previously copy-pasted into every superadmin endpoint; import from here
 * instead.
 */

/** Read an env var from the Workers platform, falling back to process.env
 * only where process exists (Node contexts) — a bare `process` reference
 * throws ReferenceError on the Workers runtime. */
function envValue(platform, name: string): string {
	const fromPlatform = (platform as { env?: Record<string, string> })?.env?.[name];
	if (fromPlatform) return fromPlatform;
	if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
	return '';
}

export function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	return envValue(platform, 'ADMIN_USER_IDS')
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

	const cronSecret = envValue(platform, 'CRON_SECRET');
	if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

	const internalKey = envValue(platform, 'INTERNAL_API_KEY');
	if (internalKey && authHeader === `Bearer ${internalKey}`) return true;

	return false;
}

/** Bearer key OR superadmin session cookie. */
export function checkInternalOrSuperAdmin({ request, cookies, platform }) {
	if (checkBearerAuth(request, platform)) return true;
	return checkIsSuperAdmin(cookies.get('discord_user_id'), platform);
}
