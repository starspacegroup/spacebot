import { filterAdminGuilds, getBotGuildIds, getUserGuilds } from '$lib/discord/guilds.js';

export interface ManageableGuild {
	id: string;
	name: string;
}

const LOOKUP_TIMEOUT_MS = 4000;

/**
 * The servers this visitor can manage that SpaceBot is also in: the ones whose public
 * listing they can edit. Public pages call this to decide whether to show a "manage
 * listing" button. It never throws, and never waits longer than a few seconds, because
 * it only decorates a page that works without it. Signed-out visitors get an empty list.
 *
 * Each page returns the promise unawaited so the page renders first and the button
 * appears when Discord answers.
 */
export async function getManageableGuilds(
	cookies: { get(name: string): string | undefined },
	platform: unknown
): Promise<ManageableGuild[]> {
	const accessToken = cookies.get('discord_access_token');
	if (!cookies.get('discord_user_id') || !accessToken) return [];

	const env = (platform as any)?.env;
	const botToken =
		env?.DISCORD_BOT_TOKEN ||
		(typeof process !== 'undefined' ? process.env?.DISCORD_BOT_TOKEN : undefined);
	if (!botToken) return [];

	try {
		const lookup = Promise.all([
			getUserGuilds(accessToken, cookies as any),
			getBotGuildIds(botToken, cookies as any),
		]).then(([userGuilds, botGuildIds]) =>
			filterAdminGuilds(userGuilds)
				.filter((guild) => botGuildIds.has(guild.id))
				.map((guild) => ({ id: guild.id as string, name: guild.name as string }))
		);
		const timeout = new Promise<ManageableGuild[]>((resolve) =>
			setTimeout(() => resolve([]), LOOKUP_TIMEOUT_MS)
		);
		return await Promise.race([lookup, timeout]);
	} catch {
		return [];
	}
}
