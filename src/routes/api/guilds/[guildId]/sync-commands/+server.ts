/**
 * Register a guild's commands, on the bot's own authority.
 *
 * The gateway calls this when SpaceBot joins a server. Until it existed, a
 * fresh server had no commands at all: the set is only pushed to Discord on a
 * command write, so an admin had to save something before `/help` — or
 * anything else — appeared. That is the same gap that left `/room` invisible
 * after the migration that added it.
 *
 * The admin-facing sync lives at `/api/commands/{guildId}/register` and needs a
 * Discord admin cookie. This one is for the gateway, which has neither a cookie
 * nor a database, and authenticates with the bot token like the room lobby.
 */

import { json } from '@sveltejs/kit';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { log } from '$lib/log.js';

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization');
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, params, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 503 });

	const guildId = params.guildId;

	try {
		const result = await syncGuildCommands(db, guildId, (platform as any)?.env);
		if (!result.success) {
			log.warn(`[Commands] Join sync failed for guild ${guildId}: ${result.error}`);
			return json({ error: result.error }, { status: 500 });
		}

		log.info(`[Commands] Registered ${result.registered} command(s) for new guild ${guildId}`);
		return json({ success: true, registered: result.registered });
	} catch (error) {
		log.error('[Commands] Join sync error:', error);
		return json({ error: 'Failed to register commands' }, { status: 500 });
	}
}
