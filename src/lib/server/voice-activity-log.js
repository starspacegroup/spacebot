import { EVENT_TYPES, getLogs, log } from "$lib/db/logger.js";

export const VOICE_ACTIVITY_DEFAULT_PAGE = 1;
export const VOICE_ACTIVITY_DEFAULT_PAGE_SIZE = 30;
export const VOICE_ACTIVITY_MAX_PAGE_SIZE = 100;

const VOICE_EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPES)
  .filter(([, meta]) => meta?.category === "voice")
  .map(([value, meta]) => ({
    value,
    label: meta?.description || value,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

function formatEventType(eventType) {
  if (!eventType) return "Voice activity";
  return eventType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildGuildAvatarUrl(guildId, userId, avatarHash, size = 64) {
  if (!guildId || !userId || !avatarHash) return null;
  const ext = String(avatarHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=${size}`;
}

export async function enrichVoiceActivityLogWithMemberCache(db, guildId, entries) {
  if (!db || !guildId || !Array.isArray(entries) || entries.length === 0) {
    return entries;
  }

  const actorIds = [...new Set(
    entries
      .map((entry) => String(entry?.actorId || "").trim())
      .filter(Boolean),
  )];

  if (actorIds.length === 0) return entries;

  try {
    const placeholders = actorIds.map(() => "?").join(", ");
    const result = await db.prepare(`
      SELECT user_id, username, discriminator, avatar, guild_avatar
      FROM guild_members_cache
      WHERE guild_id = ? AND user_id IN (${placeholders})
    `).bind(guildId, ...actorIds).all();

    const memberById = new Map(
      (result?.results || []).map((member) => [String(member.user_id), member]),
    );

    return entries.map((entry) => {
      const actorId = String(entry?.actorId || "").trim();
      if (!actorId) return entry;

      const member = memberById.get(actorId);
      if (!member) return entry;

      const guildAvatarUrl = member.guild_avatar
        ? buildGuildAvatarUrl(guildId, actorId, member.guild_avatar, 64)
        : null;

      return {
        ...entry,
        actorAvatar: entry.actorAvatar || guildAvatarUrl || member.avatar || null,
        actorDiscriminator: entry.actorDiscriminator || member.discriminator || "0",
        actorName: entry.actorName || member.username || "Unknown member",
      };
    });
  } catch (error) {
    log.debug(`[LiveVoice] Member cache enrichment skipped for ${guildId}:`, error);
    return entries;
  }
}

export function normalizeVoiceActivityLog(entries) {
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

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeDateFilter(value, mode = "start") {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (dayPattern.test(trimmed)) {
    return mode === "end" ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export function parseVoiceActivityQuery(searchParams) {
  const page = parsePositiveInt(searchParams.get("page"), VOICE_ACTIVITY_DEFAULT_PAGE, { min: 1 });
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), VOICE_ACTIVITY_DEFAULT_PAGE_SIZE, {
    min: 1,
    max: VOICE_ACTIVITY_MAX_PAGE_SIZE,
  });

  const rawSearch = String(searchParams.get("search") || "").trim();
  const search = rawSearch.slice(0, 120);

  const eventTypeRaw = String(searchParams.get("eventType") || "").trim().toUpperCase();
  const eventType = VOICE_EVENT_TYPE_OPTIONS.some((option) => option.value === eventTypeRaw) ? eventTypeRaw : "";

  const sortOrderRaw = String(searchParams.get("sort") || "desc").trim().toLowerCase();
  const sortOrder = sortOrderRaw === "asc" ? "asc" : "desc";

  const startDateRaw = String(searchParams.get("startDate") || "").trim();
  const endDateRaw = String(searchParams.get("endDate") || "").trim();

  const startDate = normalizeDateFilter(startDateRaw, "start");
  const endDate = normalizeDateFilter(endDateRaw, "end");

  return {
    page,
    pageSize,
    search,
    eventType,
    sortOrder,
    startDate,
    endDate,
    rawStartDate: startDateRaw,
    rawEndDate: endDateRaw,
  };
}

export async function getVoiceActivityLogPage(db, guildId, query) {
  const fetchPage = async (page) => {
    const offset = (page - 1) * query.pageSize;
    return getLogs(db, guildId, {
      category: "voice",
      limit: query.pageSize,
      offset,
      eventType: query.eventType || undefined,
      search: query.search || undefined,
      sortOrder: query.sortOrder,
      startDate: query.startDate || undefined,
      endDate: query.endDate || undefined,
    });
  };

  let { logs, total } = await fetchPage(query.page);
  const safeTotal = Number(total || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / query.pageSize));
  const effectivePage = Math.min(query.page, totalPages);

  if (effectivePage !== query.page) {
    const result = await fetchPage(effectivePage);
    logs = result.logs;
    total = result.total;
  }

  const normalized = normalizeVoiceActivityLog(logs);
  const enriched = await enrichVoiceActivityLogWithMemberCache(db, guildId, normalized);

  return {
    entries: enriched,
    pagination: {
      page: effectivePage,
      pageSize: query.pageSize,
      total: safeTotal,
      totalPages,
      hasPreviousPage: effectivePage > 1,
      hasNextPage: effectivePage < totalPages,
    },
  };
}

export function getVoiceEventTypeOptions() {
  return VOICE_EVENT_TYPE_OPTIONS;
}