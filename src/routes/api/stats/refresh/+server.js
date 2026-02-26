/**
 * API endpoint to refresh stats for all guilds the bot is in
 * 
 * POST /api/stats/refresh - Update stats for all guilds (requires cron secret)
 * 
 * This endpoint is designed to be called by a cron job (e.g., every hour)
 * to keep the server statistics up to date.
 * 
 * Also refreshes the member and role cache for each guild.
 */

import { json } from "@sveltejs/kit";
import { recordServerStats, fetchGuildStatsFromDiscord, pruneOldStats } from "$lib/db/server-stats.js";
import { refreshMembersCache, refreshRolesCache, updateCacheMetadata } from "$lib/db/guild-cache.js";
import { log } from "$lib/log.js";

/**
 * Verify the request has proper authorization
 */
function verifyAuth(request, platform) {
  const cronSecret = platform?.env?.CRON_SECRET || process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");
  
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const internalKey = platform?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return true;
  }

  return false;
}

/**
 * Get all guilds the bot is in
 */
async function getBotGuilds(botToken) {
  if (!botToken) return [];

  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      log.warn(`Failed to fetch bot guilds: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    log.error("Failed to fetch bot guilds:", error);
    return [];
  }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
  // Verify authorization
  if (!verifyAuth(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    // Get all guilds
    const guilds = await getBotGuilds(botToken);
    
    if (guilds.length === 0) {
      return json({ 
        success: true, 
        message: "No guilds found",
        processed: 0,
        failed: 0,
      });
    }

    const results = {
      processed: 0,
      failed: 0,
      errors: [],
      cache: {
        membersRefreshed: 0,
        rolesRefreshed: 0,
        cacheErrors: [],
      },
    };

    // Process each guild (with rate limiting consideration)
    for (const guild of guilds) {
      const startTime = Date.now();
      let statsSuccess = false;
      let cacheSuccess = false;
      let membersCount = 0;
      let rolesCount = 0;

      try {
        // Fetch stats from Discord
        const fetchResult = await fetchGuildStatsFromDiscord(botToken, guild.id);
        
        if (fetchResult) {
          const result = await recordServerStats(db, guild.id, fetchResult.stats);
          if (result.success) {
            results.processed++;
            statsSuccess = true;
          } else {
            results.failed++;
            results.errors.push({ guildId: guild.id, error: result.error });
          }
        } else {
          results.failed++;
          results.errors.push({ guildId: guild.id, error: "Failed to fetch from Discord" });
        }

        // Refresh roles cache
        const rolesResult = await refreshRolesCache(db, botToken, guild.id);
        if (rolesResult.success) {
          results.cache.rolesRefreshed++;
          rolesCount = rolesResult.count || 0;
        } else {
          results.cache.cacheErrors.push({ guildId: guild.id, type: "roles", error: rolesResult.error });
        }

        // Refresh members cache (includes all member data and their roles)
        const membersResult = await refreshMembersCache(db, botToken, guild.id, guild.owner_id);
        if (membersResult.success) {
          results.cache.membersRefreshed++;
          membersCount = membersResult.count || 0;
          cacheSuccess = true;
        } else {
          results.cache.cacheErrors.push({ guildId: guild.id, type: "members", error: membersResult.error });
        }

        // Update cache metadata
        const durationMs = Date.now() - startTime;
        await updateCacheMetadata(db, guild.id, {
          membersCount,
          rolesCount,
          membersRefreshed: membersResult.success,
          rolesRefreshed: rolesResult.success,
          durationMs,
          status: cacheSuccess ? "success" : "partial",
          error: cacheSuccess ? null : (membersResult.error || rolesResult.error),
        });

        // Small delay to avoid rate limiting (100ms between guilds for full refresh)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        results.failed++;
        results.errors.push({ guildId: guild.id, error: error.message });
        
        // Update metadata with error
        await updateCacheMetadata(db, guild.id, {
          status: "failed",
          error: error.message,
          durationMs: Date.now() - startTime,
        });
      }
    }

    // Prune old stats (cleanup)
    const pruned = await pruneOldStats(db);

    return json({
      success: true,
      totalGuilds: guilds.length,
      processed: results.processed,
      failed: results.failed,
      prunedRecords: pruned,
      cache: {
        membersRefreshed: results.cache.membersRefreshed,
        rolesRefreshed: results.cache.rolesRefreshed,
        cacheErrors: results.cache.cacheErrors.length > 0 ? results.cache.cacheErrors.slice(0, 5) : undefined,
      },
      errors: results.errors.length > 0 ? results.errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    log.error("Failed to refresh stats:", error);
    return json({ error: "Failed to refresh statistics" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform }) {
  // Simple health check / info endpoint
  const db = platform?.env?.DB;
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  return json({
    endpoint: "/api/stats/refresh",
    method: "POST",
    description: "Refreshes server statistics for all guilds",
    authorization: "Requires CRON_SECRET or INTERNAL_API_KEY",
    status: {
      database: db ? "available" : "unavailable",
      botToken: botToken ? "configured" : "missing",
    },
  });
}
