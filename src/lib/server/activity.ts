/**
 * The SpaceBot Activity: sign-in, "where am I", and "what may I see".
 *
 * An Activity is a web page Discord runs in an iframe. Everything the page
 * says about itself — who the viewer is, which server and channel it was opened
 * in, who else is in the instance — is a claim from a browser, so none of it is
 * believed. The server asks Discord instead:
 *
 *   1. Who is the viewer?        `GET /users/@me` with the viewer's own token.
 *   2. Where was this opened?    `GET /applications/:app/activity-instances/:id`
 *                                with the bot token: the instance's `location`
 *                                (a guild channel, or a DM) and its `users`.
 *   3. Is the viewer really in it, and a member of the server it names?
 *
 * Two places an Activity can run here (planning/ACTIVITY_PLAN.md):
 *
 *   - a guild voice channel — the guild comes from Discord, and the viewer must
 *     be a current member of it;
 *   - a DM — no guild at all, so the viewer sees the servers they belong to
 *     where a module is enabled. A group DM only works when every person in the
 *     instance is a member of one common server that has the module enabled.
 *
 * What comes back is a short-lived signed token plus the viewer's view: the
 * servers and modules they may use. The client only hides buttons; every module
 * endpoint re-checks on the server.
 *
 * Edge-safe: Web Crypto and `fetch` only, with `fetch` injectable for tests.
 */

import { getCommandByName } from '../db/commands.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** How long a signed session token is good for. The client refreshes before it. */
export const SESSION_TTL_SECONDS = 5 * 60;

/** More people than this in a group DM and the common-server check is refused. */
export const MAX_DM_PARTICIPANTS = 10;

/** A module the Activity can show. Each one is gated by a built-in command. */
export interface ActivityModule {
	id: string;
	name: string;
	/** The built-in command whose per-server enable switch turns this module on. */
	command: string;
	/** Shown when the module has nothing to display: what it is, how to start it. */
	help: { summary: string; start: string };
}

/**
 * The modules, in tab order. A new module is one entry here plus a tab in the
 * page. Enabling is per server, through the same override as the command.
 */
export const ACTIVITY_MODULES: ActivityModule[] = [
	{
		id: 'timebox',
		name: 'Timebox',
		command: 'timebox',
		help: {
			summary:
				'Focus blocks and breaks, alone or with everyone in a voice channel. The countdown shows here.',
			start: 'Start one with /timebox start in this server.',
		},
	},
	{
		id: 'game',
		name: 'Game',
		command: 'game',
		help: {
			summary:
				'A hidden-agent round for everyone in a voice channel: all but one are told a secret word, and the table votes out who they think was not.',
			start: 'Join a voice channel and open a lobby here, or use /game start.',
		},
	},
];

export type ContextKind = 'guild' | 'dm';

export interface ViewerGuild {
	id: string;
	name: string;
	icon: string | null;
	modules: { id: string; name: string; enabled: boolean; help: ActivityModule['help'] }[];
}

export interface ActivitySession {
	viewer: { id: string; username: string; avatar: string | null };
	context: { kind: ContextKind; guildId?: string; channelId?: string };
	guilds: ViewerGuild[];
	token: string;
	expiresAt: number;
}

export class ActivityError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message);
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ActivityEnv {
	clientId: string;
	clientSecret: string;
	botToken: string;
}

// --- signed session token -----------------------------------------------------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
	const pad = '='.repeat((4 - (text.length % 4)) % 4);
	const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
	// Derived from the client secret under a label, so no new secret to provision
	// and a token for this purpose cannot be replayed as anything else.
	return crypto.subtle.importKey(
		'raw',
		enc.encode(`spacebot-activity-session-v1:${secret}`),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[usage]
	);
}

export interface TokenClaims {
	/** viewer id */
	u: string;
	/** activity instance id */
	i: string;
	/** context kind */
	k: ContextKind;
	/** guild ids this session may touch */
	g: string[];
	/** the voice channel the Activity was opened in, for a guild session */
	c?: string;
	/** expiry, unix seconds */
	e: number;
}

export async function signSession(secret: string, claims: TokenClaims): Promise<string> {
	const body = b64url(enc.encode(JSON.stringify(claims)));
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body));
	return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Null for anything that is not a good, unexpired token made by `signSession`. */
export async function verifySession(
	secret: string,
	token: unknown,
	now = Date.now()
): Promise<TokenClaims | null> {
	if (typeof token !== 'string') return null;
	const [body, sig, extra] = token.split('.');
	if (!body || !sig || extra !== undefined) return null;
	try {
		const ok = await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret, 'verify'),
			fromB64url(sig),
			enc.encode(body)
		);
		if (!ok) return null;
		const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as TokenClaims;
		if (typeof claims?.u !== 'string' || typeof claims?.e !== 'number') return null;
		if (claims.e * 1000 <= now) return null;
		return claims;
	} catch {
		return null;
	}
}

// --- Discord calls ------------------------------------------------------------

async function discordGet(f: FetchLike, path: string, auth: string) {
	const res = await f(`${DISCORD_API}${path}`, { headers: { Authorization: auth } });
	return res;
}

/** Exchange the SDK's authorization `code` for the viewer's access token. */
export async function exchangeCode(
	env: ActivityEnv,
	code: unknown,
	f: FetchLike = fetch
): Promise<string> {
	if (typeof code !== 'string' || !code || code.length > 512) {
		throw new ActivityError(400, 'bad_code', 'Missing authorization code.');
	}
	const res = await f(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.clientId,
			client_secret: env.clientSecret,
			grant_type: 'authorization_code',
			code,
		}),
	});
	if (!res.ok) throw new ActivityError(401, 'code_rejected', 'Discord rejected the sign-in.');
	const data: any = await res.json();
	if (typeof data?.access_token !== 'string') {
		throw new ActivityError(502, 'no_token', 'Discord returned no access token.');
	}
	return data.access_token;
}

interface Instance {
	instance_id: string;
	location?: { kind?: string; guild_id?: string; channel_id?: string };
	users?: string[];
}

async function getInstance(env: ActivityEnv, instanceId: string, f: FetchLike): Promise<Instance> {
	const res = await discordGet(
		f,
		`/applications/${env.clientId}/activity-instances/${encodeURIComponent(instanceId)}`,
		`Bot ${env.botToken}`
	);
	if (res.status === 404) {
		throw new ActivityError(403, 'no_instance', 'That Activity session is not running.');
	}
	if (!res.ok) throw new ActivityError(502, 'instance_lookup', 'Could not check the session.');
	return res.json();
}

async function isGuildMember(
	env: ActivityEnv,
	guildId: string,
	userId: string,
	f: FetchLike
): Promise<boolean> {
	const res = await discordGet(f, `/guilds/${guildId}/members/${userId}`, `Bot ${env.botToken}`);
	if (res.ok) return true;
	if (res.status === 404 || res.status === 403) return false;
	throw new ActivityError(502, 'member_lookup', 'Could not check server membership.');
}

const SNOWFLAKE = /^\d{16,20}$/;

/** Modules this server has switched on, with the help text for the empty state. */
export async function modulesForGuild(db: any, guildId: string): Promise<ViewerGuild['modules']> {
	const out: ViewerGuild['modules'] = [];
	for (const m of ACTIVITY_MODULES) {
		const cmd = await getCommandByName(db, m.command, guildId);
		out.push({ id: m.id, name: m.name, enabled: Boolean(cmd), help: m.help });
	}
	return out;
}

// --- the session --------------------------------------------------------------

export interface SessionInput {
	accessToken: unknown;
	instanceId: unknown;
}

/**
 * Verify the viewer and the place they opened the Activity, and work out what
 * they may see. Throws `ActivityError` with the status to return.
 */
export async function createActivitySession(
	env: ActivityEnv,
	db: any,
	input: SessionInput,
	f: FetchLike = fetch,
	now = Date.now()
): Promise<ActivitySession> {
	const { accessToken, instanceId } = input;
	if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 512) {
		throw new ActivityError(401, 'no_token', 'Sign in again.');
	}
	if (typeof instanceId !== 'string' || !/^[\w-]{1,128}$/.test(instanceId)) {
		throw new ActivityError(400, 'bad_instance', 'This page must be opened from Discord.');
	}

	// 1. Who is this? Discord answers for the token; the client is not asked.
	const meRes = await discordGet(f, '/users/@me', `Bearer ${accessToken}`);
	if (!meRes.ok) throw new ActivityError(401, 'bad_token', 'Sign in again.');
	const me: any = await meRes.json();
	if (!me?.id || !SNOWFLAKE.test(me.id)) {
		throw new ActivityError(401, 'bad_token', 'Sign in again.');
	}

	// 2. Where was it opened, and is this person in it?
	const instance = await getInstance(env, instanceId, f);
	const users = (instance.users ?? []).map(String);
	if (!users.includes(me.id)) {
		throw new ActivityError(403, 'not_in_instance', 'You are not in this Activity session.');
	}

	const kind = instance.location?.kind;
	let context: ActivitySession['context'];
	let guilds: ViewerGuild[] = [];
	let allowed: string[] = [];

	if (kind === 'gc' && instance.location?.guild_id) {
		// A guild voice channel. The guild is Discord's answer, not the client's.
		const guildId = String(instance.location.guild_id);
		if (!SNOWFLAKE.test(guildId)) {
			throw new ActivityError(502, 'bad_location', 'Unexpected session location.');
		}
		if (!(await isGuildMember(env, guildId, me.id, f))) {
			throw new ActivityError(403, 'not_a_member', 'You are not a member of this server.');
		}
		const guildRes = await discordGet(f, `/guilds/${guildId}`, `Bot ${env.botToken}`);
		const guild: any = guildRes.ok
			? await guildRes.json()
			: { id: guildId, name: 'This server' };
		context = {
			kind: 'guild',
			guildId,
			channelId: instance.location.channel_id
				? String(instance.location.channel_id)
				: undefined,
		};
		guilds = [
			{
				id: guildId,
				name: guild.name ?? 'This server',
				icon: guild.icon ?? null,
				modules: await modulesForGuild(db, guildId),
			},
		];
		allowed = [guildId];
	} else if (kind === 'pc') {
		// A DM or group DM: no guild. Show the viewer's servers where a module is on.
		if (users.length > MAX_DM_PARTICIPANTS) {
			throw new ActivityError(403, 'too_many', 'Too many people in this chat.');
		}
		const gRes = await discordGet(f, '/users/@me/guilds', `Bearer ${accessToken}`);
		if (!gRes.ok) throw new ActivityError(401, 'bad_token', 'Sign in again.');
		const userGuilds: any[] = await gRes.json();

		const others = users.filter((id) => id !== me.id);
		for (const g of userGuilds) {
			if (!g?.id || !SNOWFLAKE.test(g.id)) continue;
			const modules = await modulesForGuild(db, g.id);
			if (!modules.some((m) => m.enabled)) continue;
			// Group DM: everyone connected must be a member of this same server.
			let everyone = true;
			for (const other of others) {
				if (!(await isGuildMember(env, g.id, other, f))) {
					everyone = false;
					break;
				}
			}
			if (!everyone) continue;
			guilds.push({ id: g.id, name: g.name ?? 'Server', icon: g.icon ?? null, modules });
		}
		context = { kind: 'dm' };
		allowed = guilds.map((g) => g.id);
	} else {
		throw new ActivityError(
			403,
			'unsupported_context',
			'The SpaceBot Activity runs in a voice channel or a direct message.'
		);
	}

	const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
	const token = await signSession(env.clientSecret, {
		u: me.id,
		i: instanceId,
		k: context.kind,
		g: allowed,
		...(context.channelId ? { c: context.channelId } : {}),
		e: expiresAt,
	});

	return {
		viewer: {
			id: me.id,
			username: me.global_name || me.username || 'You',
			avatar: me.avatar ?? null,
		},
		context,
		guilds,
		token,
		expiresAt,
	};
}

/** Read the bearer token off a request and verify it. Null when it is not good. */
export async function sessionFromRequest(
	request: Request,
	secret: string
): Promise<TokenClaims | null> {
	const header = request.headers.get('authorization') || '';
	const m = /^Bearer (.+)$/.exec(header);
	return m ? verifySession(secret, m[1]) : null;
}
