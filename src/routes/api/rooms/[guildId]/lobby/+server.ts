/**
 * Join-to-create: the gateway reports that a member joined a lobby voice
 * channel, and this creates their room.
 *
 * The gateway holds no database of its own, so room creation stays here — one
 * implementation shared with `/room create`, same caps, same overwrites, same
 * ownership row. The gateway's only job afterwards is moving the member in.
 */

import { json } from '@sveltejs/kit';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { createManagedRoom } from '$lib/automation/managed-channels.js';
import { getChannelPresetByLobby, listLobbyChannelIds } from '$lib/db/managed-channels.js';
import { normalizeRoomName } from '$lib/discord/managed-channel-policy.js';
import { processTemplate } from '$lib/automation/engine.js';
import { log } from '$lib/log.js';

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization');
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, params, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 503 });

	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const guildId = params.guildId;

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const lobbyChannelId = body?.lobby_channel_id;
	const userId = body?.user_id;
	if (!lobbyChannelId || !userId) {
		return json({ error: 'lobby_channel_id and user_id are required' }, { status: 400 });
	}

	// The gateway caches this list and skips the round trip entirely for joins
	// to channels that are not lobbies, so it rides along on every reply.
	const lobbyChannelIds = await listLobbyChannelIds(db, guildId);

	const preset = lobbyChannelIds.includes(String(lobbyChannelId))
		? await getChannelPresetByLobby(db, guildId, lobbyChannelId)
		: null;
	// Not every voice channel is a lobby; this is the common answer.
	if (!preset) {
		return json({ created: false, reason: 'not_a_lobby', lobby_channel_ids: lobbyChannelIds });
	}

	const displayName = body?.display_name || body?.user_name || 'member';
	const context = {
		user: { id: userId, name: displayName, mention: `<@${userId}>` },
		guild: { id: guildId },
	};

	const result = await createManagedRoom({
		db,
		discord: createDiscordRestClient(botToken),
		guildId,
		preset,
		ownerId: String(userId),
		ownerName: displayName,
		ownerRoleIds: Array.isArray(body?.role_ids) ? body.role_ids.map(String) : [],
		name: normalizeRoomName(processTemplate(preset.name_pattern, context), ''),
		botId: body?.bot_id || null,
		reason: `Lobby room for ${displayName}`,
	});

	if (!result.success) {
		log.info(`[Rooms] Lobby create refused in ${guildId}: ${result.error}`);
		return json({ created: false, reason: result.error, lobby_channel_ids: lobbyChannelIds });
	}

	return json({
		created: true,
		channel_id: result.channelId,
		name: result.name,
		lobby_channel_ids: lobbyChannelIds,
	});
}
