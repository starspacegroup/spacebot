/**
 * Policy for member-owned ("managed") channels — pure decisions, no I/O.
 *
 * Everything here is deliberately free of Discord and D1 calls so the rules that
 * matter (who may create a room, what the owner is allowed to do to it, when it
 * dies) can be tested directly and reused by the interaction path, the gateway
 * lobby and the reaper without three copies drifting apart.
 */

import { PermissionFlagsBits } from 'discord-api-types/v10';

/** Discord channel types this feature creates. */
export const CHANNEL_TYPE_TEXT = 0;
export const CHANNEL_TYPE_VOICE = 2;

/** Verbs a room owner can be granted over their own room. */
export const ROOM_VERBS = [
	'rename',
	'invite',
	'kick',
	'lock',
	'limit',
	'transfer',
	'extend',
	'delete',
] as const;

export type RoomVerb = (typeof ROOM_VERBS)[number];

/** Lifetime modes a preset can use. */
export const LIFETIME_MODES = ['fixed', 'idle', 'manual'] as const;

/**
 * Permission flags a preset may reference by name.
 *
 * Names, not bitfields, so the stored preset and the dashboard stay readable and
 * a typo fails loudly instead of silently granting the wrong bit.
 */
export const PERMISSION_FLAGS: Record<string, bigint> = {
	CREATE_INSTANT_INVITE: PermissionFlagsBits.CreateInstantInvite,
	VIEW_CHANNEL: PermissionFlagsBits.ViewChannel,
	SEND_MESSAGES: PermissionFlagsBits.SendMessages,
	MANAGE_MESSAGES: PermissionFlagsBits.ManageMessages,
	READ_MESSAGE_HISTORY: PermissionFlagsBits.ReadMessageHistory,
	CONNECT: PermissionFlagsBits.Connect,
	SPEAK: PermissionFlagsBits.Speak,
	STREAM: PermissionFlagsBits.Stream,
	USE_VAD: PermissionFlagsBits.UseVAD,
	PRIORITY_SPEAKER: PermissionFlagsBits.PrioritySpeaker,
	MUTE_MEMBERS: PermissionFlagsBits.MuteMembers,
	DEAFEN_MEMBERS: PermissionFlagsBits.DeafenMembers,
	MOVE_MEMBERS: PermissionFlagsBits.MoveMembers,
};

/**
 * Permissions a room owner is never granted through an overwrite, however the
 * preset is configured.
 *
 * Granting MANAGE_CHANNELS is the tempting shortcut for rename/limit, and it
 * hands the member powers `owner_can` cannot take back: editing the channel's
 * permissions freely, and deleting the channel out from under its ownership
 * row so the reaper and every verb lose track of it. Every verb runs through
 * the bot with an ownership check instead.
 */
export const OWNER_FORBIDDEN_PERMISSIONS = new Set([
	'ADMINISTRATOR',
	'MANAGE_CHANNELS',
	'MANAGE_ROLES',
	'MANAGE_GUILD',
	'MANAGE_WEBHOOKS',
]);

/** Permissions the bot keeps on every room so a private room stays manageable. */
export const BOT_ROOM_PERMISSIONS = ['VIEW_CHANNEL', 'CONNECT', 'MOVE_MEMBERS'];

export const OVERWRITE_TYPE_ROLE = 0;
export const OVERWRITE_TYPE_MEMBER = 1;

/**
 * Turn permission names into a Discord bitfield string.
 * Unknown names are ignored rather than throwing, so one bad row in a preset
 * cannot break room creation for a whole guild.
 */
export function permissionNamesToBits(names: unknown): string {
	if (!Array.isArray(names)) return '0';
	let bits = 0n;
	for (const name of names) {
		const flag = PERMISSION_FLAGS[String(name).toUpperCase()];
		if (flag) bits |= flag;
	}
	return String(bits);
}

/** Drop permissions a room owner must never receive. See {@link OWNER_FORBIDDEN_PERMISSIONS}. */
export function sanitizeOwnerPermissions(names: unknown): string[] {
	if (!Array.isArray(names)) return [];
	return names
		.map((name) => String(name).toUpperCase())
		.filter((name) => !OWNER_FORBIDDEN_PERMISSIONS.has(name));
}

export interface OverwriteTargets {
	ownerId: string;
	/** The @everyone role id, which equals the guild id. */
	everyoneRoleId: string;
	/** The bot's own user id, so it keeps access to a hidden room. */
	botId?: string | null;
}

/**
 * Build the `permission_overwrites` array for a new room.
 *
 * Applied at creation rather than patched afterwards, so a private room is
 * never briefly visible to @everyone.
 */
export function buildRoomOverwrites(preset: any, targets: OverwriteTargets) {
	const overwrites: Array<Record<string, string | number>> = [];

	const everyoneDeny = permissionNamesToBits(preset?.everyone_deny);
	if (everyoneDeny !== '0') {
		overwrites.push({
			id: targets.everyoneRoleId,
			type: OVERWRITE_TYPE_ROLE,
			allow: '0',
			deny: everyoneDeny,
		});
	}

	const ownerAllow = permissionNamesToBits(sanitizeOwnerPermissions(preset?.owner_allow));
	overwrites.push({
		id: targets.ownerId,
		type: OVERWRITE_TYPE_MEMBER,
		allow: ownerAllow,
		deny: '0',
	});

	if (targets.botId) {
		overwrites.push({
			id: targets.botId,
			type: OVERWRITE_TYPE_MEMBER,
			allow: permissionNamesToBits(BOT_ROOM_PERMISSIONS),
			deny: '0',
		});
	}

	return overwrites;
}

/**
 * Decide whether a member may create a room from this preset.
 *
 * Discord's per-command role permissions (v2) cannot be set with a bot token —
 * that endpoint needs a user Bearer token with Manage Guild — so "only @Trusted
 * may make rooms" has to be enforced here, on top of the command's own
 * `default_member_permissions` gate.
 */
export function memberMayCreate(
	preset: any,
	memberRoleIds: string[] = []
): { allowed: boolean; reason?: string } {
	if (!preset) return { allowed: false, reason: 'preset_missing' };
	if (preset.enabled === 0 || preset.enabled === false) {
		return { allowed: false, reason: 'preset_disabled' };
	}

	const roles = new Set((memberRoleIds || []).map(String));
	const deny = Array.isArray(preset.deny_role_ids) ? preset.deny_role_ids.map(String) : [];
	if (deny.some((roleId) => roles.has(roleId))) {
		return { allowed: false, reason: 'role_denied' };
	}

	const allow = Array.isArray(preset.allow_role_ids) ? preset.allow_role_ids.map(String) : [];
	// An empty allow list means "anyone who got past the command's permission gate".
	if (allow.length > 0 && !allow.some((roleId) => roles.has(roleId))) {
		return { allowed: false, reason: 'role_not_allowed' };
	}

	return { allowed: true };
}

/** Whether the preset delegates a verb to the room's owner. */
export function ownerMayUseVerb(preset: any, verb: string): boolean {
	if (!preset) return false;
	const verbs = Array.isArray(preset.owner_can) ? preset.owner_can.map(String) : [];
	return verbs.includes(verb);
}

/**
 * Resolve the expiry timestamp a freshly created room should carry.
 *
 * Voice rooms on an `idle` preset carry no deadline — they die when they empty
 * out. Text rooms have no occupancy to measure, so `idle` falls back to the
 * fixed TTL rather than inventing a "last message" scan.
 */
export function initialExpiresAt(preset: any, now: Date = new Date()): string | null {
	const mode = preset?.lifetime_mode || 'idle';
	if (mode === 'manual') return null;

	const isVoice = Number(preset?.channel_type) === CHANNEL_TYPE_VOICE;
	if (mode === 'idle' && isVoice) return null;

	const ttl = Number(preset?.ttl_minutes) || 0;
	if (ttl <= 0) return null;
	return new Date(now.getTime() + ttl * 60_000).toISOString();
}

/** Parse a SQLite datetime ("YYYY-MM-DD HH:MM:SS", UTC) or ISO string. */
export function parseDbTime(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	const str = String(value).trim();
	if (!str) return null;
	// SQLite's CURRENT_TIMESTAMP has no zone marker but is UTC.
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)
		? `${str.replace(' ', 'T')}Z`
		: str;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface ExpiryDecision {
	due: boolean;
	reason: 'expired' | 'idle' | null | 'grace' | 'occupied' | 'manual' | 'not_active' | 'waiting';
}

/**
 * Decide whether a room should be reaped now.
 *
 * @param room     Row from `managed_channels`.
 * @param preset   Its preset (policy is read at run time, not frozen at creation).
 * @param occupied Whether a *human* is currently in the channel.
 * @param now      Clock, injectable for tests.
 */
export function evaluateRoomExpiry(
	room: any,
	preset: any,
	occupied: boolean,
	now: Date = new Date()
): ExpiryDecision {
	if (!room || room.status !== 'active') return { due: false, reason: 'not_active' };

	const created = parseDbTime(room.created_at);
	const graceMinutes = Number(preset?.grace_minutes ?? 0);
	if (created && graceMinutes > 0) {
		// A room must survive long enough for its creator to actually connect.
		if (now.getTime() - created.getTime() < graceMinutes * 60_000) {
			return { due: false, reason: 'grace' };
		}
	}

	// A hard deadline wins in every mode that has one, including as a backstop
	// on an idle room whose preset also set one.
	const expiresAt = parseDbTime(room.expires_at);
	if (expiresAt && now.getTime() >= expiresAt.getTime()) {
		return { due: true, reason: 'expired' };
	}

	const mode = preset?.lifetime_mode || 'idle';
	if (mode === 'manual') return { due: false, reason: 'manual' };
	if (mode !== 'idle') return { due: false, reason: 'waiting' };

	if (occupied) return { due: false, reason: 'occupied' };

	const emptySince = parseDbTime(room.empty_since);
	// First scan that sees it empty only records the transition.
	if (!emptySince) return { due: false, reason: 'waiting' };

	const idleMinutes = Number(preset?.idle_minutes ?? 15);
	if (now.getTime() - emptySince.getTime() >= idleMinutes * 60_000) {
		return { due: true, reason: 'idle' };
	}

	return { due: false, reason: 'waiting' };
}

/**
 * Whether `/room extend` can meaningfully do anything for this room.
 *
 * An idle voice room has no deadline to push out — it lasts exactly as long as
 * somebody is in it — so extending is refused with that explanation rather than
 * silently succeeding.
 */
export function canExtend(room: any, preset: any): { allowed: boolean; reason?: string } {
	if (!room || room.status !== 'active') return { allowed: false, reason: 'room_closed' };
	if (!room.expires_at) return { allowed: false, reason: 'no_deadline' };

	const max = Number(preset?.max_extensions ?? 0);
	if (Number(room.extensions_used ?? 0) >= max) {
		return { allowed: false, reason: 'max_extensions' };
	}
	return { allowed: true };
}

/** Clamp a requested voice user limit to Discord's accepted range. */
export function clampUserLimit(value: unknown): number | null {
	// An absent limit means "no opinion", not 0 — and 0 is Discord's own value
	// for "unlimited", so conflating them would silently remove a preset's cap.
	if (value === null || value === undefined || value === '') return null;
	const num = Number(value);
	if (!Number.isFinite(num)) return null;
	return Math.max(0, Math.min(99, Math.trunc(num)));
}

/**
 * Trim a room name to Discord's channel-name length limit.
 * Discord also rejects an empty name, so a blank pattern falls back.
 */
export function normalizeRoomName(name: unknown, fallback = 'room'): string {
	const trimmed = String(name ?? '').trim();
	return (trimmed || fallback).slice(0, 100);
}
