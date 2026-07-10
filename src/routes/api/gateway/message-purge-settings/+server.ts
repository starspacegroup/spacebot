import { json } from '@sveltejs/kit';
import { getMessagePurgeSettings } from '$lib/server/message-purge-settings.js';

/**
 * GET /api/gateway/message-purge-settings
 *
 * Lets the Discord gateway (which has no direct D1) read the superadmin message
 * lookback settings so its inline delete actions honour the same cap as the edge.
 * Bot-token authed, mirroring the other /api/gateway/* endpoints.
 */

function getEnv(platform: any, name: string) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

function checkIsBotRequest(request: Request, platform: any) {
	const authHeader = request.headers.get('Authorization');
	const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function GET({ request, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const settings = await getMessagePurgeSettings(db);
	return json(settings);
}
