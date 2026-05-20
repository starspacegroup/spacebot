import { redirect } from "@sveltejs/kit";
import { EVENT_TYPES, getLogs, log } from "$lib/db/logger.js";
import { getLiveVoiceChannels } from "$lib/db/live-voice.js";
import {
  LIVE_UPDATE_TOKEN_TTL_SECONDS,
  signLiveUpdateAccess,
} from "$lib/live-updates.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";

const VOICE_ACTIVITY_LOG_LIMIT = 30;

function formatEventType(eventType) {
  if (!eventType) return "Voice activity";
  return eventType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeVoiceActivityLog(entries) {
  return (entries || []).map((entry) => {
    const details = entry?.details && typeof entry.details === "object" ? entry.details : {};
    const eventType = entry?.event_type || null;
    const eventMeta = eventType ? EVENT_TYPES[eventType] : null;
    const fromChannelName = details.oldChannelName || details.fromChannelName || details.previousChannelName || null;
    const channelName =
      entry?.channel_name || details.newChannelName || details.toChannelName || details.channelName || fromChannelName || "Unknown channel";

    let actionLabel = eventMeta?.description || formatEventType(eventType);
    if (eventType === "VOICE_MOVE" && fromChannelName && channelName && fromChannelName !== channelName) {
      actionLabel = `Moved from ${fromChannelName} to ${channelName}`;
    }

    return {
      id: entry.id,
      eventType,
      actorId: entry?.actor_id || null,
      actorName: entry?.actor_name || "Unknown member",
      actorAvatar: entry?.actor_avatar || null,
      actorDiscriminator: entry?.actor_discriminator || "0",
      channelName,
      actionLabel,
      createdAt: entry?.created_at || null,
    };
  });
}

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, cookies, platform, parent }) {
  const { serverId } = params;

  if (!/^\d{17,20}$/.test(serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();

  if (!parentData.isLoggedIn || !parentData.user) {
    throw redirect(302, "/login");
  }

  const userId = cookies.get("discord_user_id");
  const isSuperAdmin = checkIsSuperAdmin(userId, platform);
  const adminGuilds = parentData.adminGuilds || [];

  const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  const guild = adminGuilds.find((g) => g.id === serverId);
  const db = platform?.env?.DB;

  let liveVoiceSnapshot = null;
  let voiceActivityLog = [];
  let liveUpdatesAuth = null;

  if (db) {
    try {
      liveVoiceSnapshot = await getLiveVoiceChannels(db, serverId);
    } catch (error) {
      log.warn(`[LiveVoice] Failed to fetch snapshot for ${serverId}:`, error);
    }

    try {
      const { logs } = await getLogs(db, serverId, {
        category: "voice",
        limit: VOICE_ACTIVITY_LOG_LIMIT,
      });
      voiceActivityLog = normalizeVoiceActivityLog(logs);
    } catch (error) {
      log.warn(`[LiveVoice] Failed to fetch voice activity log for ${serverId}:`, error);
    }
  }

  const liveUpdateSecret = getEnv(platform, "INTERNAL_API_KEY") || getEnv(platform, "DISCORD_BOT_TOKEN");
  const liveUpdateUserId = userId || parentData.user?.id;
  if (liveUpdateSecret && liveUpdateUserId) {
    const expiresAt = Math.floor(Date.now() / 1000) + LIVE_UPDATE_TOKEN_TTL_SECONDS;
    liveUpdatesAuth = {
      userId: liveUpdateUserId,
      expiresAt,
      signature: await signLiveUpdateAccess(serverId, liveUpdateUserId, expiresAt, liveUpdateSecret),
    };
  }

  return {
    serverId,
    guild,
    liveVoiceSnapshot,
    voiceActivityLog,
    liveUpdatesAuth,
    user: parentData.user,
  };
}
