/**
 * Can this member see this channel? Discord's own algorithm, for the places
 * that answer a member from the bot's side (the Activity) and so cannot lean on
 * an interaction's `member.permissions`: base permissions from @everyone and the
 * member's roles, then the channel's overwrites for @everyone, roles, and the
 * member. Pure; the caller fetches the data.
 */

export const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;

export interface Overwrite {
	id: string;
	/** 0 = role, 1 = member */
	type: number;
	allow: string;
	deny: string;
}

export interface GuildRole {
	id: string;
	permissions: string;
}

export function canViewChannel(input: {
	guildId: string;
	ownerId: string | null;
	userId: string;
	guildRoles: GuildRole[];
	memberRoles: string[];
	overwrites: Overwrite[];
}): boolean {
	const { guildId, ownerId, userId, guildRoles, memberRoles, overwrites } = input;
	if (ownerId && ownerId === userId) return true;

	const bits = (s: unknown) => {
		try {
			return BigInt(String(s ?? '0'));
		} catch {
			return 0n;
		}
	};

	let perms = bits(guildRoles.find((r) => r.id === guildId)?.permissions);
	for (const role of guildRoles) {
		if (memberRoles.includes(role.id)) perms |= bits(role.permissions);
	}
	if (perms & ADMINISTRATOR) return true;

	const apply = (o?: Overwrite) => {
		if (!o) return;
		perms &= ~bits(o.deny);
		perms |= bits(o.allow);
	};
	apply(overwrites.find((o) => o.type === 0 && o.id === guildId));

	let deny = 0n;
	let allow = 0n;
	for (const o of overwrites) {
		if (o.type === 0 && memberRoles.includes(o.id)) {
			deny |= bits(o.deny);
			allow |= bits(o.allow);
		}
	}
	perms &= ~deny;
	perms |= allow;

	apply(overwrites.find((o) => o.type === 1 && o.id === userId));
	return (perms & VIEW_CHANNEL) !== 0n;
}
