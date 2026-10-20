/**
 * Tenant binding for channel targets (security review 2026-10-20, #2).
 *
 * Channel IDs are global in Discord. A guild's automation config could name a
 * channel in any other guild the bot is in, and the bot would post there or
 * delete from it with that guild's permissions. Every stored channel target is
 * resolved through this check against the guild that owns the config.
 */

export function channelGuildId(channel: any): string | null {
	const id = channel?.guildId ?? channel?.guild_id ?? channel?.guild?.id ?? null;
	return id == null ? null : String(id);
}

export async function fetchGuildChannel(
	discord: any,
	channelId: string,
	guildId: string | null | undefined
) {
	if (!guildId || !channelId) return null;
	const channel = await discord.channels.fetch(channelId).catch(() => null);
	if (!channel || channelGuildId(channel) !== String(guildId)) return null;
	return channel;
}

export async function channelBelongsToGuild(
	botToken: string,
	channelId: string,
	guildId: string | null | undefined,
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	if (!guildId || !channelId) return false;
	const res = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}`, {
		headers: { Authorization: `Bot ${botToken}` },
	});
	if (!res.ok) return false;
	return channelGuildId(await res.json()) === String(guildId);
}
