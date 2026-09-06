/**
 * Member-owned room operations.
 *
 * The interaction path (`/room …`) and the gateway's join-to-create lobby both
 * come through here, so creating a room means the same thing — same caps, same
 * overwrites, same ownership row — whichever way it started.
 *
 * Authorization is deliberate and repeated: a verb resolves the caller's room
 * out of `managed_channels` rather than trusting a channel id off the
 * interaction, so `/room kick` cannot reach a channel the caller does not own.
 */

import { log } from '../log.js';
import {
	closeManagedChannel,
	countActiveRoomsForGuild,
	countActiveRoomsForUser,
	getChannelPreset,
	getManagedChannel,
	getOwnedManagedChannel,
	recordManagedChannel,
	updateManagedChannel,
} from '../db/managed-channels.js';
import {
	CHANNEL_TYPE_VOICE,
	buildRoomOverwrites,
	canExtend,
	clampUserLimit,
	initialExpiresAt,
	memberMayCreate,
	normalizeRoomName,
	ownerMayUseVerb,
	parseDbTime,
	permissionNamesToBits,
	OVERWRITE_TYPE_MEMBER,
	OVERWRITE_TYPE_ROLE,
} from '../discord/managed-channel-policy.js';

/** Outcome of one room operation, shaped for the action executor. */
export interface RoomOperationResult {
	success: boolean;
	error?: string;
	response?: { content?: string; embeds?: any[]; ephemeral?: boolean };
	channel?: any;
	channelId?: string;
	name?: string;
	expiresAt?: string | null;
}

/** Permissions an invited member needs, by channel kind. */
function accessPermissions(channelType) {
	return Number(channelType) === CHANNEL_TYPE_VOICE
		? ['VIEW_CHANNEL', 'CONNECT']
		: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY'];
}

/** Turn a Discord API failure into something a member can act on. */
function describeDiscordError(error, fallback) {
	const status = error?.status;
	if (status === 403) {
		return "SpaceBot doesn't have permission to do that here. Check its role and channel permissions.";
	}
	if (status === 429) {
		return 'Discord is rate limiting that right now — try again in a minute.';
	}
	if (status === 400 && /maximum number of channels/i.test(error?.message || '')) {
		return 'This server has hit its Discord channel limit.';
	}
	return error?.message || fallback;
}

/**
 * Create a room from a preset.
 *
 * @param name Already-resolved channel name (the caller owns template
 *             expansion, so this module never has to import the engine and
 *             create an import cycle).
 */
export async function createManagedRoom({
	db,
	discord,
	guildId,
	preset,
	ownerId,
	ownerName = null,
	ownerRoleIds = [],
	name = null,
	userLimit = undefined,
	botId = null,
	reason = 'Self-service room',
}: Record<string, any>): Promise<RoomOperationResult> {
	if (!db) return { success: false, error: 'Database not available' };
	if (!preset) {
		return { success: false, error: 'No room preset is set up on this server yet.' };
	}

	const gate = memberMayCreate(preset, ownerRoleIds);
	if (!gate.allowed) {
		const messages = {
			preset_disabled: 'Rooms are turned off on this server right now.',
			role_denied: "Your roles don't allow creating a room here.",
			role_not_allowed: "You don't have a role that can create rooms here.",
			preset_missing: 'No room preset is set up on this server yet.',
		};
		return { success: false, error: messages[gate.reason] || 'You cannot create a room here.' };
	}

	const perUser = Number(preset.max_per_user ?? 0);
	if (perUser > 0) {
		const mine = await countActiveRoomsForUser(db, guildId, ownerId, preset.id);
		if (mine >= perUser) {
			return {
				success: false,
				error:
					perUser === 1
						? 'You already have a room open. Close it before making another.'
						: `You already have ${mine} rooms open (max ${perUser}).`,
			};
		}
	}

	const perGuild = Number(preset.max_per_guild ?? 0);
	if (perGuild > 0) {
		const total = await countActiveRoomsForGuild(db, guildId, preset.id);
		if (total >= perGuild) {
			return {
				success: false,
				error: 'This server has as many rooms open as it allows right now.',
			};
		}
	}

	const channelName = normalizeRoomName(name, `${ownerName || 'member'}'s room`);
	const overwrites = buildRoomOverwrites(preset, {
		ownerId,
		// @everyone's role id is the guild id.
		everyoneRoleId: guildId,
		botId,
	});

	const limit =
		userLimit === undefined
			? clampUserLimit(preset.default_user_limit)
			: clampUserLimit(userLimit);

	let channel;
	try {
		const guild = await discord.guilds.fetch(guildId);
		channel = await guild.channels.create({
			name: channelName,
			type: Number(preset.channel_type ?? CHANNEL_TYPE_VOICE),
			parent: preset.parent_id || undefined,
			permissionOverwrites: overwrites,
			userLimit:
				Number(preset.channel_type ?? CHANNEL_TYPE_VOICE) === CHANNEL_TYPE_VOICE &&
				limit !== null
					? limit
					: undefined,
			reason,
		});
	} catch (error) {
		log.error('[ManagedChannels] Channel creation failed:', error);
		return { success: false, error: describeDiscordError(error, 'Could not create the room.') };
	}

	const expiresAt = initialExpiresAt(preset);
	const recorded = await recordManagedChannel(db, {
		guild_id: guildId,
		channel_id: channel.id,
		preset_id: preset.id,
		owner_user_id: ownerId,
		owner_user_name: ownerName,
		channel_name: channelName,
		channel_type: Number(preset.channel_type ?? CHANNEL_TYPE_VOICE),
		expires_at: expiresAt,
	});

	if (!recorded.success) {
		// An unrecorded room is an orphan nothing can manage or reap. Undo it
		// rather than leaving a channel behind with no owner.
		try {
			await discord.channels.delete(channel.id, 'Rolling back unrecorded self-service room');
		} catch (error) {
			log.error('[ManagedChannels] Failed to roll back unrecorded room:', error);
		}
		return { success: false, error: 'Could not record the room. Nothing was created.' };
	}

	return { success: true, channel, channelId: channel.id, name: channelName, expiresAt };
}

/** Resolve the room a verb should act on, and say why not when it cannot. */
async function resolveRoomForVerb(db, { guildId, actorId, channelId, isModerator }) {
	if (isModerator && channelId) {
		const room = await getManagedChannel(db, channelId);
		if (room && String(room.guild_id) === String(guildId)) {
			return { room, asModerator: String(room.owner_user_id) !== String(actorId) };
		}
	}

	const owned = await getOwnedManagedChannel(db, guildId, actorId, channelId);
	if (owned) return { room: owned, asModerator: false };

	return { room: null, asModerator: false };
}

/**
 * Run one management verb against the caller's room.
 *
 * @param options Verb arguments read off the interaction (`user`, `name`, …).
 */
export async function runRoomVerb({
	db,
	discord,
	guildId,
	actorId,
	verb,
	channelId = null,
	options = {},
	isModerator = false,
	reason = 'Self-service room',
}: Record<string, any>): Promise<RoomOperationResult> {
	if (!db) return { success: false, error: 'Database not available' };

	const { room, asModerator } = await resolveRoomForVerb(db, {
		guildId,
		actorId,
		channelId,
		isModerator,
	});

	if (!room) {
		return {
			success: false,
			error: "You don't have a room open here. Use `/room create` first.",
		};
	}

	const preset = await getChannelPreset(db, guildId, room.preset_id);

	// A moderator acting on someone else's room bypasses the delegated verb
	// list; the room's own owner does not.
	if (!asModerator && !ownerMayUseVerb(preset, verb)) {
		return { success: false, error: `Your room doesn't allow \`${verb}\`.` };
	}

	try {
		switch (verb) {
			case 'rename':
				return await verbRename({ db, discord, room, preset, options, reason });
			case 'invite':
				return await verbInvite({ discord, room, options, reason });
			case 'kick':
				return await verbKick({ discord, room, guildId, actorId, options, reason });
			case 'lock':
				return await verbLock({ db, discord, room, preset, guildId, lock: true, reason });
			case 'unlock':
				return await verbLock({ db, discord, room, preset, guildId, lock: false, reason });
			case 'limit':
				return await verbLimit({ db, discord, room, options, reason });
			case 'transfer':
				return await verbTransfer({ db, discord, room, preset, options, actorId, reason });
			case 'extend':
				return await verbExtend({ db, room, preset });
			case 'delete':
				return await verbDelete({ db, discord, room, reason });
			default:
				return { success: false, error: `Unknown room command \`${verb}\`.` };
		}
	} catch (error) {
		log.error(`[ManagedChannels] Verb ${verb} failed:`, error);
		return { success: false, error: describeDiscordError(error, 'That did not work.') };
	}
}

async function verbRename({
	db,
	discord,
	room,
	preset,
	options,
	reason,
}): Promise<RoomOperationResult> {
	const requested = normalizeRoomName(options.name, '');
	if (!requested) return { success: false, error: 'Give the room a name.' };

	// Discord throttles channel renames to 2 per 10 minutes per channel. The REST
	// client would sit on the 429 and the interaction would expire, so refuse
	// with an explanation instead of hanging.
	const max = Number(preset?.max_renames ?? 0);
	if (max > 0 && Number(room.renames_used ?? 0) >= max) {
		return {
			success: false,
			error: `You've renamed this room ${room.renames_used} times — that's the limit Discord's rename throttle allows.`,
		};
	}

	await discord.channels.edit(room.channel_id, { name: requested }, reason);
	await updateManagedChannel(db, room.channel_id, {
		channel_name: requested,
		renames_used: Number(room.renames_used ?? 0) + 1,
	});

	return { success: true, response: { content: `✏️ Renamed to **${requested}**.` } };
}

async function verbInvite({ discord, room, options, reason }): Promise<RoomOperationResult> {
	const userId = options.user;
	if (!userId) return { success: false, error: 'Say who to invite.' };

	await discord.channels.permissions(room.channel_id).set(
		String(userId),
		{
			allow: permissionNamesToBits(accessPermissions(room.channel_type)),
			deny: '0',
			type: OVERWRITE_TYPE_MEMBER,
		},
		reason
	);

	return { success: true, response: { content: `✅ <@${userId}> can join now.` } };
}

async function verbKick({
	discord,
	room,
	guildId,
	actorId,
	options,
	reason,
}): Promise<RoomOperationResult> {
	const userId = options.user ? String(options.user) : null;
	if (!userId) return { success: false, error: 'Say who to remove.' };
	if (userId === String(actorId)) {
		return { success: false, error: "You can't remove yourself — use `/room delete`." };
	}
	if (userId === String(room.owner_user_id)) {
		return { success: false, error: "You can't remove the room's owner." };
	}

	await discord.channels.permissions(room.channel_id).set(
		userId,
		{
			allow: '0',
			deny: permissionNamesToBits(accessPermissions(room.channel_type)),
			type: OVERWRITE_TYPE_MEMBER,
		},
		reason
	);

	// Denying CONNECT does not evict somebody already connected.
	if (Number(room.channel_type) === CHANNEL_TYPE_VOICE) {
		try {
			const guild = await discord.guilds.fetch(guildId);
			const member = await guild.members.fetch(userId);
			if (member?.voice?.channelId === String(room.channel_id)) {
				await member.voice.disconnect(reason);
			}
		} catch (error) {
			log.warn('[ManagedChannels] Could not disconnect kicked member:', error?.message);
		}
	}

	return { success: true, response: { content: `🚪 <@${userId}> was removed.` } };
}

async function verbLock({
	db,
	discord,
	room,
	preset,
	guildId,
	lock,
	reason,
}): Promise<RoomOperationResult> {
	const baseDeny = Array.isArray(preset?.everyone_deny) ? [...preset.everyone_deny] : [];
	const lockDeny = accessPermissions(room.channel_type);
	const deny = lock ? [...new Set([...baseDeny, ...lockDeny])] : baseDeny;

	await discord.channels.permissions(room.channel_id).set(
		String(guildId),
		{
			allow: '0',
			deny: permissionNamesToBits(deny),
			type: OVERWRITE_TYPE_ROLE,
		},
		reason
	);

	await updateManagedChannel(db, room.channel_id, { locked: lock ? 1 : 0 });

	return {
		success: true,
		response: {
			content: lock
				? '🔒 Locked. Only people you invite can get in.'
				: '🔓 Unlocked, back to the preset default.',
		},
	};
}

async function verbLimit({ db, discord, room, options, reason }): Promise<RoomOperationResult> {
	if (Number(room.channel_type) !== CHANNEL_TYPE_VOICE) {
		return { success: false, error: 'User limits only apply to voice rooms.' };
	}

	const limit = clampUserLimit(options.limit);
	if (limit === null) return { success: false, error: 'Give a number from 0 to 99.' };

	await discord.channels.edit(room.channel_id, { user_limit: limit }, reason);
	void db;

	return {
		success: true,
		response: {
			content: limit === 0 ? '👥 User limit removed.' : `👥 User limit set to ${limit}.`,
		},
	};
}

async function verbTransfer({
	db,
	discord,
	room,
	preset,
	options,
	actorId,
	reason,
}): Promise<RoomOperationResult> {
	const newOwnerId = options.user ? String(options.user) : null;
	if (!newOwnerId) return { success: false, error: 'Say who should own the room.' };
	if (newOwnerId === String(room.owner_user_id)) {
		return { success: false, error: 'They already own it.' };
	}

	await discord.channels.permissions(room.channel_id).set(
		newOwnerId,
		{
			allow: permissionNamesToBits(
				Array.isArray(preset?.owner_allow) ? preset.owner_allow : []
			),
			deny: '0',
			type: OVERWRITE_TYPE_MEMBER,
		},
		reason
	);

	await updateManagedChannel(db, room.channel_id, {
		owner_user_id: newOwnerId,
		owner_user_name: null,
	});
	void actorId;

	return { success: true, response: { content: `👑 <@${newOwnerId}> owns this room now.` } };
}

async function verbExtend({ db, room, preset }): Promise<RoomOperationResult> {
	const check = canExtend(room, preset);
	if (!check.allowed) {
		const messages = {
			no_deadline: 'This room lasts as long as someone is in it — nothing to extend.',
			max_extensions: "You've extended this room as many times as it allows.",
			room_closed: 'That room is already closed.',
		};
		return { success: false, error: messages[check.reason] || 'Cannot extend this room.' };
	}

	const minutes = Number(preset?.extend_minutes ?? 30);
	const current = parseDbTime(room.expires_at) || new Date();
	const base = Math.max(current.getTime(), Date.now());
	const next = new Date(base + minutes * 60_000).toISOString();

	await updateManagedChannel(db, room.channel_id, {
		expires_at: next,
		extensions_used: Number(room.extensions_used ?? 0) + 1,
	});

	return {
		success: true,
		response: { content: `⏳ Extended by ${minutes} minutes.` },
	};
}

async function verbDelete({ db, discord, room, reason }): Promise<RoomOperationResult> {
	try {
		await discord.channels.delete(room.channel_id, reason);
	} catch (error) {
		// Already gone in Discord is a success for our purposes; the row still
		// has to close.
		if (error?.status !== 404) throw error;
	}
	await closeManagedChannel(db, room.channel_id, 'owner_deleted');
	return { success: true, response: { content: '🧹 Room closed.' } };
}
