/**
 * Permanent guild invites for the public server browser.
 *
 * The listing's Join button is only as good as its invite, and the single most
 * likely way for a listing to rot is an admin pasting a 7-day invite. So the bot
 * makes the link itself: it prefers something that already exists and is
 * permanent, and only mints a new one as a last resort.
 */

const API_BASE = 'https://discord.com/api/v10';

/** Channel types an invite can point at. Categories (4) and threads cannot. */
const INVITABLE_CHANNEL_TYPES = new Set([
	0, // GUILD_TEXT
	2, // GUILD_VOICE
	5, // GUILD_ANNOUNCEMENT
	13, // GUILD_STAGE_VOICE
	15, // GUILD_FORUM
]);

async function discordFetch(botToken: string, path: string, init: Record<string, any> = {}) {
	const { method = 'GET', body, reason } = init;
	const headers: Record<string, string> = {
		Authorization: `Bot ${botToken}`,
		'Content-Type': 'application/json',
	};
	if (reason) headers['X-Audit-Log-Reason'] = reason;

	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers,
		body: body != null ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const data: any = await res.json().catch(() => ({}));
		const err: any = new Error(data?.message || `Discord API ${res.status}`);
		err.status = res.status;
		err.code = data?.code;
		throw err;
	}
	return res.status === 204 ? null : res.json();
}

/**
 * Flat rather than a discriminated union: this codebase's TS config doesn't
 * narrow `{ok:true}|{ok:false}` at the call sites, and a result shape that
 * fights its consumers isn't worth the extra precision.
 */
export interface InviteResult {
	ok: boolean;
	url?: string;
	source?: 'vanity' | 'existing' | 'created';
	error?: string;
}

export function inviteUrlFromCode(code: string | null | undefined): string | null {
	const clean = String(code || '').trim();
	return /^[A-Za-z0-9-]{1,64}$/.test(clean) ? `https://discord.gg/${clean}` : null;
}

/** A permanent invite never expires and has unlimited uses. */
export function isPermanentInvite(invite: Record<string, any>): boolean {
	return Number(invite?.max_age ?? -1) === 0 && Number(invite?.max_uses ?? -1) === 0;
}

/**
 * Pick the best existing permanent invite.
 *
 * Prefers one the bot made itself (we know its settings and can explain it),
 * then any other permanent one, so a guild that already has a public invite
 * keeps using the link its members recognise.
 */
export function pickExistingInvite(
	invites: Record<string, any>[],
	botUserId?: string | null
): Record<string, any> | null {
	const permanent = (invites || []).filter(isPermanentInvite);
	if (permanent.length === 0) return null;
	const ours = botUserId && permanent.find((i) => i.inviter?.id === botUserId);
	return ours || permanent[0];
}

/**
 * Rank channels for invite creation.
 *
 * Rules and system channels are where a server already points newcomers, so
 * they beat an arbitrary first channel. Everything else falls back to guild
 * order, which mirrors what a human would pick from the channel list.
 */
export function pickInviteChannels(
	channels: Record<string, any>[],
	{
		rulesChannelId,
		systemChannelId,
	}: { rulesChannelId?: string | null; systemChannelId?: string | null } = {}
): Record<string, any>[] {
	const invitable = (channels || []).filter((c) => INVITABLE_CHANNEL_TYPES.has(Number(c?.type)));
	const score = (c: Record<string, any>) => {
		if (rulesChannelId && c.id === rulesChannelId) return 0;
		if (systemChannelId && c.id === systemChannelId) return 1;
		if (Number(c.type) === 0) return 2; // plain text next
		return 3;
	};
	return invitable.sort(
		(a, b) => score(a) - score(b) || Number(a.position ?? 0) - Number(b.position ?? 0)
	);
}

/**
 * Resolve a permanent invite for a guild, creating one only if needed.
 *
 * Order: the guild's own vanity URL (permanent and branded, and costs nothing)
 * → an existing permanent invite → a freshly minted one. Creation walks the
 * ranked channel list and lets Discord be the authority on permissions: rather
 * than trying to compute overwrites ourselves, we attempt and move on when a
 * channel says no.
 */
export async function resolvePermanentInvite(
	botToken: string,
	guildId: string,
	{
		vanityUrlCode = null,
		rulesChannelId = null,
		systemChannelId = null,
		botUserId = null,
		maxAttempts = 5,
	}: {
		vanityUrlCode?: string | null;
		rulesChannelId?: string | null;
		systemChannelId?: string | null;
		botUserId?: string | null;
		maxAttempts?: number;
	} = {}
): Promise<InviteResult> {
	if (!botToken) return { ok: false, error: 'Bot token is not configured.' };
	if (!/^\d{17,20}$/.test(String(guildId || ''))) {
		return { ok: false, error: 'Invalid guild id.' };
	}

	const vanity = inviteUrlFromCode(vanityUrlCode);
	if (vanity) return { ok: true, url: vanity, source: 'vanity' as const };

	// Reuse before creating — clicking the button twice shouldn't litter the
	// server's invite list. Needs MANAGE_GUILD; if we can't read them, carry on.
	try {
		const existing = (await discordFetch(botToken, `/guilds/${guildId}/invites`)) as any[];
		const reusable = pickExistingInvite(existing || [], botUserId);
		const url = inviteUrlFromCode(reusable?.code);
		if (url) return { ok: true, url, source: 'existing' as const };
	} catch {
		// No MANAGE_GUILD, or the call failed — fall through to creation.
	}

	let channels: any[];
	try {
		channels = ((await discordFetch(botToken, `/guilds/${guildId}/channels`)) as any[]) || [];
	} catch (error: any) {
		// Discord's own wording here ("401: Unauthorized", "Missing Access") tells an
		// admin nothing about what to do, so translate the cases they can act on.
		const status = Number(error?.status || 0);
		if (status === 401) {
			return {
				ok: false,
				error: 'SpaceBot could not authenticate with Discord. The operator needs to check the bot token.',
			};
		}
		if (status === 403 || status === 404) {
			return {
				ok: false,
				error: 'SpaceBot cannot see this server. Check that the bot is still a member, then try again.',
			};
		}
		return {
			ok: false,
			error: `Could not read this server’s channels (${error?.message || 'unknown error'}).`,
		};
	}

	const candidates = pickInviteChannels(channels, { rulesChannelId, systemChannelId });
	if (candidates.length === 0) {
		return { ok: false, error: 'This server has no channel an invite can point at.' };
	}

	let lastError = 'SpaceBot could not create an invite in any channel.';
	for (const channel of candidates.slice(0, maxAttempts)) {
		try {
			const invite: any = await discordFetch(botToken, `/channels/${channel.id}/invites`, {
				method: 'POST',
				body: { max_age: 0, max_uses: 0, temporary: false, unique: false },
				reason: 'Permanent invite for the SpaceBot public server browser',
			});
			const url = inviteUrlFromCode(invite?.code);
			if (url) return { ok: true, url, source: 'created' as const };
		} catch (error: any) {
			// 50013 = Missing Permissions on that channel; try the next one.
			lastError = error?.message || lastError;
		}
	}

	return {
		ok: false,
		error: `${lastError} Give SpaceBot the "Create Invite" permission in a channel and try again.`,
	};
}
