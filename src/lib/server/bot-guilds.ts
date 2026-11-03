import { log } from '$lib/db/logger.js';

export interface DiscordApiGuild {
	id: string;
	name?: string;
	icon?: string | null;
	owner?: boolean;
	owner_id?: string | null;
	approximate_member_count?: number;
	features?: string[];
	[key: string]: any;
}

/**
 * Get all guilds the bot is currently in from the Discord API.
 */
export async function getBotGuilds(
	botToken: string | undefined,
	fetchImpl: typeof fetch = fetch,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<{ guilds: DiscordApiGuild[]; available: boolean; reason?: string }> {
	if (!botToken) {
		return { guilds: [], available: false, reason: 'no bot token on the site' };
	}

	// Discord allows this call once a second per bot, and the gateway and the cron
	// jobs use the same allowance, so a 429 is normal. Wait the time Discord names
	// and ask again instead of giving up on the first one.
	let reason = 'Discord did not answer';
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const response = await fetchImpl(
				'https://discord.com/api/v10/users/@me/guilds?with_counts=true',
				{ headers: { Authorization: `Bot ${botToken}` } }
			);

			if (response.ok) {
				return { guilds: (await response.json()) as DiscordApiGuild[], available: true };
			}

			if (response.status === 429) {
				const body: any = await response.json().catch(() => ({}));
				const waitMs = Math.min(
					3000,
					Math.max(250, Math.ceil(Number(body?.retry_after ?? 1) * 1000) + 100)
				);
				reason = `Discord rate limited the request (${body?.global ? 'global' : 'per route'}, retry after ${body?.retry_after ?? '?'}s)`;
				log.warn(`[Superadmin Servers] bot guilds 429 on attempt ${attempt}: ${reason}`);
				if (attempt < 3) await sleep(waitMs);
				continue;
			}

			reason = `Discord answered ${response.status}`;
			log.warn(`[Superadmin Servers] Failed to fetch bot guilds: ${response.status}`);
			break;
		} catch (error) {
			reason = 'the request to Discord failed';
			log.error('[Superadmin Servers] Failed to fetch bot guilds:', error);
			break;
		}
	}
	return { guilds: [], available: false, reason };
}
