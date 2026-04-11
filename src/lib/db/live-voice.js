import { log } from "$lib/log.js";

function getMemberValue(member, camelKey, snakeKey, fallback = null) {
  if (member?.[camelKey] !== undefined && member?.[camelKey] !== null) {
    return member[camelKey];
  }
  if (member?.[snakeKey] !== undefined && member?.[snakeKey] !== null) {
    return member[snakeKey];
  }
  return fallback;
}

function getMemberBoolean(member, camelKey, snakeKey) {
  return Boolean(getMemberValue(member, camelKey, snakeKey, false));
}

export function buildLiveVoiceSnapshot(members = [], updatedAtOverride = null) {
  const channelsById = new Map();
  let activeCameras = 0;
  let activeStreams = 0;
  let updatedAt = updatedAtOverride;

  for (const row of members) {
    const channelId = getMemberValue(row, "channelId", "channel_id");
    const userId = getMemberValue(row, "userId", "user_id");
    if (!channelId || !userId) {
      continue;
    }

    if (!channelsById.has(channelId)) {
      channelsById.set(channelId, {
        channelId,
        channelName: getMemberValue(row, "channelName", "channel_name", "Unknown Channel") || "Unknown Channel",
        members: [],
      });
    }

    const member = {
      userId,
      userName: getMemberValue(row, "userName", "user_name", "Unknown User") || "Unknown User",
      displayName: getMemberValue(row, "displayName", "display_name") || getMemberValue(row, "userName", "user_name", "Unknown User") || "Unknown User",
      avatarUrl: getMemberValue(row, "avatarUrl", "avatar_url"),
      selfMute: getMemberBoolean(row, "selfMute", "self_mute"),
      selfDeaf: getMemberBoolean(row, "selfDeaf", "self_deaf"),
      serverMute: getMemberBoolean(row, "serverMute", "server_mute"),
      serverDeaf: getMemberBoolean(row, "serverDeaf", "server_deaf"),
      streaming: getMemberBoolean(row, "streaming", "streaming"),
      selfVideo: getMemberBoolean(row, "selfVideo", "self_video"),
      suppress: getMemberBoolean(row, "suppress", "suppress"),
    };

    if (member.selfVideo) activeCameras++;
    if (member.streaming) activeStreams++;

    const rowUpdatedAt = getMemberValue(row, "updatedAt", "updated_at");
    if (!updatedAt || (rowUpdatedAt && rowUpdatedAt > updatedAt)) {
      updatedAt = rowUpdatedAt;
    }

    channelsById.get(channelId).members.push(member);
  }

  const channels = [...channelsById.values()]
    .map((channel) => ({
      ...channel,
      memberCount: channel.members.length,
    }))
    .sort((left, right) => {
      if (right.memberCount !== left.memberCount) {
        return right.memberCount - left.memberCount;
      }
      return left.channelName.localeCompare(right.channelName);
    });

  return {
    channels,
    totalUsers: channels.reduce((sum, channel) => sum + channel.memberCount, 0),
    totalChannels: channels.length,
    activeCameras,
    activeStreams,
    updatedAt: updatedAt || null,
  };
}

function normalizeMemberState(member = {}) {
  return {
    guild_id: String(member.guild_id),
    user_id: String(member.user_id),
    user_name: member.user_name ? String(member.user_name) : null,
    display_name: member.display_name ? String(member.display_name) : null,
    avatar_url: member.avatar_url ? String(member.avatar_url) : null,
    channel_id: String(member.channel_id),
    channel_name: member.channel_name ? String(member.channel_name) : null,
    self_mute: member.self_mute ? 1 : 0,
    self_deaf: member.self_deaf ? 1 : 0,
    server_mute: member.server_mute ? 1 : 0,
    server_deaf: member.server_deaf ? 1 : 0,
    streaming: member.streaming ? 1 : 0,
    self_video: member.self_video ? 1 : 0,
    suppress: member.suppress ? 1 : 0,
  };
}

/**
 * Replace the stored live voice snapshot for a guild.
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Array<Object>} members
 */
export async function replaceLiveVoiceSnapshot(db, guildId, members = []) {
  if (!db || !guildId) {
    return { success: false, error: "Database or guildId missing" };
  }

  try {
    const normalizedMembers = members
      .filter((member) => member?.user_id && member?.channel_id)
      .map((member) => normalizeMemberState({ ...member, guild_id: guildId }));

    const existing = await db.prepare(`
      SELECT user_id
      FROM live_voice_states
      WHERE guild_id = ?
    `).bind(guildId).all();

    const existingUserIds = new Set((existing.results || []).map((row) => String(row.user_id)));
    const incomingUserIds = new Set(normalizedMembers.map((member) => member.user_id));

    for (const userId of existingUserIds) {
      if (!incomingUserIds.has(userId)) {
        await db.prepare(`
          DELETE FROM live_voice_states
          WHERE guild_id = ? AND user_id = ?
        `).bind(guildId, userId).run();
      }
    }

    for (const member of normalizedMembers) {
      await db.prepare(`
        INSERT INTO live_voice_states (
          guild_id,
          user_id,
          user_name,
          display_name,
          avatar_url,
          channel_id,
          channel_name,
          self_mute,
          self_deaf,
          server_mute,
          server_deaf,
          streaming,
          self_video,
          suppress,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(guild_id, user_id)
        DO UPDATE SET
          user_name = excluded.user_name,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          channel_id = excluded.channel_id,
          channel_name = excluded.channel_name,
          self_mute = excluded.self_mute,
          self_deaf = excluded.self_deaf,
          server_mute = excluded.server_mute,
          server_deaf = excluded.server_deaf,
          streaming = excluded.streaming,
          self_video = excluded.self_video,
          suppress = excluded.suppress,
          updated_at = datetime('now')
      `).bind(
        member.guild_id,
        member.user_id,
        member.user_name,
        member.display_name,
        member.avatar_url,
        member.channel_id,
        member.channel_name,
        member.self_mute,
        member.self_deaf,
        member.server_mute,
        member.server_deaf,
        member.streaming,
        member.self_video,
        member.suppress,
      ).run();
    }

    return { success: true, memberCount: normalizedMembers.length };
  } catch (error) {
    log.error("[LiveVoice] Failed to replace snapshot:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get the current live voice snapshot for a guild grouped by channel.
 * @param {D1Database} db
 * @param {string} guildId
 */
export async function getLiveVoiceChannels(db, guildId) {
  if (!db || !guildId) {
    return {
      channels: [],
      totalUsers: 0,
      totalChannels: 0,
      activeCameras: 0,
      activeStreams: 0,
      updatedAt: null,
    };
  }

  try {
    const result = await db.prepare(`
      SELECT
        user_id,
        user_name,
        display_name,
        avatar_url,
        channel_id,
        channel_name,
        self_mute,
        self_deaf,
        server_mute,
        server_deaf,
        streaming,
        self_video,
        suppress,
        updated_at
      FROM live_voice_states
      WHERE guild_id = ?
      ORDER BY channel_name COLLATE NOCASE ASC, display_name COLLATE NOCASE ASC, user_name COLLATE NOCASE ASC
    `).bind(guildId).all();
    return buildLiveVoiceSnapshot(result.results || []);
  } catch (error) {
    log.error("[LiveVoice] Failed to fetch snapshot:", error);
    return {
      channels: [],
      totalUsers: 0,
      totalChannels: 0,
      activeCameras: 0,
      activeStreams: 0,
      updatedAt: null,
    };
  }
}