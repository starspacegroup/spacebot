import { json } from "@sveltejs/kit";
import {
  filterAdminGuilds,
  getBotGuildIds,
  getUserGuilds,
} from "$lib/discord/guilds.js";
import {
  getVoiceActivityLogPage,
  getVoiceEventTypeOptions,
  parseVoiceActivityQuery,
} from "$lib/server/voice-activity-log.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ params, cookies, platform, url }) {
  const { serverId } = params;

  if (!/^\d{17,20}$/.test(serverId || "")) {
    return json({ error: "Invalid server id" }, { status: 400 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const userId = cookies.get("discord_user_id");
  const accessToken = cookies.get("discord_access_token");

  if (!userId || !accessToken) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const isSuperAdmin = checkIsSuperAdmin(userId, platform);

  if (!isSuperAdmin) {
    const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
    const [userGuilds, botGuildIds] = await Promise.all([
      getUserGuilds(accessToken, cookies),
      getBotGuildIds(botToken, cookies),
    ]);

    const adminGuilds = filterAdminGuilds(userGuilds);
    const hasAccess = adminGuilds.some((guild) => guild.id === serverId) &&
      botGuildIds.has(serverId);

    if (!hasAccess) {
      return json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const query = parseVoiceActivityQuery(url.searchParams);
  const page = await getVoiceActivityLogPage(db, serverId, query);

  return json({
    entries: page.entries,
    pagination: page.pagination,
    filters: {
      search: query.search,
      eventType: query.eventType,
      sortOrder: query.sortOrder,
      startDate: query.rawStartDate,
      endDate: query.rawEndDate,
    },
    eventTypeOptions: getVoiceEventTypeOptions(),
  }, {
    headers: {
      "cache-control": "no-store",
    },
  });
}