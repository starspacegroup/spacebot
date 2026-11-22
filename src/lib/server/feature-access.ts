/**
 * Which parts of a server's dashboard a member may use, beyond what Manage Server gives.
 *
 * The rule itself is proved in dafny/FeatureAccess.dfy and compiled to
 * ./generated/feature-access-core.js by scripts/build-dafny.mjs. This file moves facts into
 * it: who the member is, what Discord says they hold, and which roles the server picked on
 * Settings. It never decides anything itself.
 *
 *  - Administrator, Manage Server, the owner and SpaceBot superadmins keep every feature.
 *  - A role picked for a row grants that row's feature and the dashboard door. Nothing here
 *    reaches Settings, billing, API keys or any other page.
 *  - The permission level dropdowns on Settings are NOT read here. Two live servers have levels
 *    saved that never took effect; honoring them now would surprise both.
 *  - Roles come from Discord with the bot token, never from a cookie. A lookup that fails means
 *    no access.
 */

import { FeatureAccessCore } from './generated/feature-access-core.js';
import { getGuildSettings } from '$lib/db/settings.js';
import { getUserGuilds, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from './superadmin-guard.js';
import { log } from '$lib/db/logger.js';

const core = FeatureAccessCore.__default;

export type Feature = 'dashboard' | 'logs' | 'automations' | 'commands';
export type FeatureSet = Record<Feature, boolean>;

export const FEATURES: Feature[] = ['dashboard', 'logs', 'automations', 'commands'];

/** The Settings row each feature is saved under. */
export const FEATURE_RULE_KEY: Record<Feature, string> = {
	dashboard: 'viewDashboard',
	logs: 'viewLogs',
	automations: 'manageAutomations',
	commands: 'manageCommands',
};

type Rules = Record<string, { roles?: unknown } | undefined> | null | undefined;

export const NO_FEATURES: FeatureSet = {
	dashboard: false,
	logs: false,
	automations: false,
	commands: false,
};

export const ALL_FEATURES: FeatureSet = {
	dashboard: true,
	logs: true,
	automations: true,
	commands: true,
};

/** The role ids saved for one feature. Anything that is not a plain id string is dropped. */
export function roleIdsFor(rules: Rules, feature: Feature): string[] {
	const list = rules?.[FEATURE_RULE_KEY[feature]]?.roles;
	return Array.isArray(list)
		? list.filter((id): id is string => typeof id === 'string' && /^\d{17,20}$/.test(id))
		: [];
}

/** Whether any of the four rows has a role saved. Cheap test before asking Discord anything. */
export function hasAnyRoleRule(rules: Rules): boolean {
	return FEATURES.some((f) => roleIdsFor(rules, f).length > 0);
}

export interface Standing {
	superAdmin: boolean;
	owner: boolean;
	administrator: boolean;
	manageGuild: boolean;
}

/** The decision. Pure: the same inputs always give the same answer. */
export function decideFeatures(
	standing: Standing,
	memberRoles: readonly string[],
	rules: Rules
): FeatureSet {
	const held = new Set(memberRoles.map(String));
	const holds = (f: Feature) => roleIdsFor(rules, f).some((id) => held.has(id));
	const full = core.Full(
		standing.superAdmin,
		standing.owner,
		standing.administrator,
		standing.manageGuild
	);
	const rd = holds('dashboard');
	const rl = holds('logs');
	const ra = holds('automations');
	const rc = holds('commands');
	return {
		dashboard: core.MayDashboard(full, rd, rl, ra, rc),
		logs: core.MayLogs(full, rl),
		automations: core.MayAutomations(full, ra),
		commands: core.MayCommands(full, rc),
	};
}

export function hasAnyFeature(set: FeatureSet | null | undefined): boolean {
	return Boolean(set && FEATURES.some((f) => set[f]));
}

// ---- Discord: a member's roles --------------------------------------------------------

const ROLE_CACHE_MS = 30_000;
const ROLE_CACHE_MAX = 500;
const roleCache = new Map<string, { roles: string[]; until: number }>();

/** Test hook. */
export function clearRoleCache() {
	roleCache.clear();
}

/**
 * The member's role ids in a guild, from Discord with the bot token. Null when the lookup
 * fails for any reason (bot not in the guild, not a member, rate limit, timeout): callers
 * treat that as no access. Kept 30 seconds so a page that makes several calls asks once, and
 * a removed role stops working within half a minute.
 */
export async function fetchMemberRoles(
	botToken: string | undefined,
	guildId: string,
	userId: string
): Promise<string[] | null> {
	if (!botToken || !/^\d{17,20}$/.test(guildId) || !/^\d{1,25}$/.test(userId)) return null;
	const key = `${guildId}:${userId}`;
	const hit = roleCache.get(key);
	if (hit && hit.until > Date.now()) return hit.roles;
	try {
		const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
			headers: { Authorization: `Bot ${botToken}` },
			signal: AbortSignal.timeout(4000),
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { roles?: unknown };
		const roles = Array.isArray(body?.roles) ? body.roles.map(String) : [];
		if (roleCache.size >= ROLE_CACHE_MAX) roleCache.clear();
		roleCache.set(key, { roles, until: Date.now() + ROLE_CACHE_MS });
		return roles;
	} catch (error) {
		log.warn('[FeatureAccess] role lookup failed:', error);
		return null;
	}
}

// ---- Putting it together -----------------------------------------------------------------

type Ctx = {
	guildId: string;
	cookies: import('@sveltejs/kit').Cookies;
	platform: unknown;
};

function envOf(platform: unknown, name: string): string | undefined {
	const fromPlatform = (platform as { env?: Record<string, string> })?.env?.[name];
	if (fromPlatform) return fromPlatform;
	return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

/**
 * What this request's member may use in this guild. Superadmins and members with Manage Server
 * answer from the cached guild list with no extra calls. Anyone else costs one database read,
 * and one Discord call only when the server has saved a role.
 */
export async function resolveFeatures({ guildId, cookies, platform }: Ctx): Promise<FeatureSet> {
	const accessToken = cookies.get('discord_access_token');
	const userId = cookies.get('discord_user_id'); // equals the signed session's id (hooks)
	if (!accessToken || !userId) return NO_FEATURES;

	if (checkIsSuperAdmin(userId, platform)) return ALL_FEATURES;

	const admin = await verifyGuildAdmin(guildId, accessToken, cookies);
	if (admin?.authorized) return ALL_FEATURES;

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return NO_FEATURES;

	const guilds = await getUserGuilds(accessToken, cookies);
	if (!guilds.some((g: { id: string }) => g.id === guildId)) return NO_FEATURES;

	const settings = await getGuildSettings(db, guildId);
	const rules = settings?.permission_settings;
	if (!hasAnyRoleRule(rules)) return NO_FEATURES;

	const roles = await fetchMemberRoles(envOf(platform, 'DISCORD_BOT_TOKEN'), guildId, userId);
	if (!roles) return NO_FEATURES;

	return decideFeatures(
		{ superAdmin: false, owner: false, administrator: false, manageGuild: false },
		roles,
		rules
	);
}

/** True when this request's member may use `feature` in the guild. */
export async function mayUseFeature(ctx: Ctx, feature: Feature): Promise<boolean> {
	return (await resolveFeatures(ctx))[feature] === true;
}

// ---- The servers a member can open only through a role ---------------------------------

export interface MemberGuild {
	id: string;
	name?: string;
	icon?: string | null;
	botIsInServer: true;
	/** What the member's roles allow here. Never every feature: those members are admins. */
	features: FeatureSet;
}

/**
 * Saved permission settings for the given guilds, only those that have at least one role saved.
 * One query per 80 guilds (D1 allows 100 bound values per statement).
 */
export async function loadRoleRules(
	db: {
		prepare: (sql: string) => {
			bind: (...v: unknown[]) => { all: () => Promise<{ results?: unknown[] }> };
		};
	},
	guildIds: string[]
): Promise<Map<string, Record<string, { roles?: unknown }>>> {
	const out = new Map<string, Record<string, { roles?: unknown }>>();
	for (let i = 0; i < guildIds.length; i += 80) {
		const chunk = guildIds.slice(i, i + 80);
		const res = await db
			.prepare(
				`SELECT guild_id, permission_settings FROM guild_settings WHERE guild_id IN (${chunk.map(() => '?').join(',')})`
			)
			.bind(...chunk)
			.all();
		for (const row of (res?.results ?? []) as {
			guild_id: string;
			permission_settings: string | null;
		}[]) {
			try {
				const parsed = JSON.parse(row.permission_settings || 'null');
				if (hasAnyRoleRule(parsed)) out.set(row.guild_id, parsed);
			} catch {
				// A row that does not parse grants nothing.
			}
		}
	}
	return out;
}

/**
 * The guilds the member can open through a role only: they are in it, the bot is in it, they
 * are not an admin there, and a role they hold is saved on one of the four rows.
 */
export async function buildMemberGuilds({
	userGuilds,
	botGuildIds,
	adminGuildIds,
	userId,
	botToken,
	db,
}: {
	userGuilds: { id: string; name?: string; icon?: string | null }[];
	botGuildIds: Set<string>;
	adminGuildIds: Set<string>;
	userId: string | undefined;
	botToken: string | undefined;
	db: unknown;
}): Promise<MemberGuild[]> {
	if (!db || !userId || !botToken) return [];
	const candidates = userGuilds.filter((g) => !adminGuildIds.has(g.id) && botGuildIds.has(g.id));
	if (candidates.length === 0) return [];
	const rules = await loadRoleRules(
		db as never,
		candidates.map((g) => g.id)
	);
	const found = await Promise.all(
		candidates
			.filter((g) => rules.has(g.id))
			.map(async (g): Promise<MemberGuild | null> => {
				const roles = await fetchMemberRoles(botToken, g.id, userId);
				if (!roles) return null;
				const features = decideFeatures(
					{ superAdmin: false, owner: false, administrator: false, manageGuild: false },
					roles,
					rules.get(g.id)
				);
				return hasAnyFeature(features)
					? {
							id: g.id,
							name: g.name,
							icon: g.icon ?? null,
							botIsInServer: true,
							features,
						}
					: null;
			})
	);
	return found
		.filter((g): g is MemberGuild => g !== null)
		.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Drop-in for `verifyGuildAdmin` on routes that belong to one feature: admins pass as before,
 * and so does a member whose saved role covers `feature`. Answers the same `{ authorized }`.
 */
export async function verifyGuildFeature(
	guildId: string,
	accessToken: string | undefined,
	cookies: import('@sveltejs/kit').Cookies,
	platform: unknown,
	feature: Feature | Feature[]
): Promise<{ authorized: boolean; error?: string; guild?: unknown }> {
	const admin = await verifyGuildAdmin(guildId, accessToken, cookies);
	if (admin?.authorized) return admin;
	const have = await resolveFeatures({ guildId, cookies, platform });
	if ([feature].flat().some((f) => have[f])) return { authorized: true };
	return admin ?? { authorized: false, error: 'Unauthorized' };
}
