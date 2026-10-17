/**
 * A server's name and icon for a page header when the viewer's Discord guild
 * list does not have it (a superadmin looking at a server they are not in, or a
 * rate-limited /users/@me/guilds). D1's `guild_metadata` first, then the bot's
 * own view of the server. Display fields only: nothing here grants access.
 */
import { getGuildMetadata } from '../db/guild-metadata.js';

export interface DisplayGuild {
	id: string;
	name: string;
	icon: string | null;
}

export async function fallbackDisplayGuild(
	db: any,
	serverId: string,
	botToken?: string | null
): Promise<DisplayGuild | null> {
	const meta = db ? await getGuildMetadata(db, serverId) : null;
	if (meta?.name) return { id: serverId, name: meta.name, icon: meta.icon || null };
	if (!botToken) return null;
	try {
		const res = await fetch(`https://discord.com/api/v10/guilds/${serverId}`, {
			headers: { Authorization: `Bot ${botToken}` },
		});
		if (!res.ok) return null;
		const g: any = await res.json();
		return g?.name ? { id: serverId, name: g.name, icon: g.icon || null } : null;
	} catch {
		return null;
	}
}
