/**
 * Called by the gateway bot when a server's name or icon changes, so a bot identity that
 * follows the defaults ("<server name>Bot", the server icon) follows the server.
 * Auth: the bot token, as for /api/automations/:guildId/process.
 */
import { json } from '@sveltejs/kit';
import { applyBotIdentity } from '$lib/db/bot-identity.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
	const token = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const auth = request.headers.get('Authorization');
	if (!token || auth !== `Bot ${token}`) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!/^\d{17,20}$/.test(params.guildId))
		return json({ error: 'Bad guild id' }, { status: 400 });
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	const result = await applyBotIdentity(db, token, params.guildId);
	return json({ success: result.ok, skipped: result.ok ? (result.skipped ?? false) : undefined });
}
