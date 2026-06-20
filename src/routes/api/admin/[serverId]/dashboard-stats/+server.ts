import { json } from "@sveltejs/kit";
import {
  filterAdminGuilds,
  getBotGuildIds,
  getUserGuilds,
} from "$lib/discord/guilds.js";
import { getGuildTimezone } from "$lib/db/settings.js";
import {
  fetchDashboardLiveData,
  getDashboardCacheEntry,
} from "$lib/server/dashboard-stats.js";

// Backs the admin dashboard's client-side hotload: src/routes/admin/[serverId]/+page.svelte
// fetches this directly instead of using goto(url, { invalidateAll: true }), which forced
// every loader in the route tree (including the root layout's Discord guild-list fetch)
// through SvelteKit's client-side data-merge machinery just to refresh one page's stats.

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ params, cookies, platform }) {
  const { serverId } = params;

  if (!/^\d{17,20}$/.test(serverId || "")) {
    return json({ error: "Invalid server id" }, { status: 400 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const userId = cookies.get("discord_user_id");
  const accessToken = cookies.get("discord_access_token");

  if (!userId || !accessToken) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  if (!checkIsSuperAdmin(userId, platform)) {
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

  const { cachedEntry, hasFreshCache } = getDashboardCacheEntry(serverId);
  if (hasFreshCache && cachedEntry?.data) {
    return json(cachedEntry.data, {
      headers: { "cache-control": "no-store" },
    });
  }

  const userTimezone = cookies.get("user_timezone") || null;
  const serverTimezone = await getGuildTimezone(db, serverId);
  const timezone = userTimezone || serverTimezone || null;

  const result = await fetchDashboardLiveData(db, serverId, botToken, timezone);

  if (!result.success) {
    return json({ error: "Failed to load dashboard stats" }, { status: 502 });
  }

  return json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
