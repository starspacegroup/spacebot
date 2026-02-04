/**
 * API endpoint to refresh stats for all guilds the bot is in
 * 
 * POST /api/stats/refresh - Update stats for all guilds (requires cron secret)
 * 
 * This endpoint is designed to be called by a cron job (e.g., every hour)
 * to keep the server statistics up to date.
 */

import { json } from "@sveltejs/kit";
import { recordServerStats, fetchGuildStatsFromDiscord, pruneOldStats } from "$lib/db/server-stats.js";
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
    };

    // Process each guild (with rate limiting consideration)
    for (const guild of guilds) {
      try {
        // Fetch stats from Discord
        const stats = await fetchGuildStatsFromDiscord(botToken, guild.id);
        
        if (stats) {
          const result = await recordServerStats(db, guild.id, stats);
          if (result.success) {
            results.processed++;
          } else {
            results.failed++;
            results.errors.push({ guildId: guild.id, error: result.error });
          }
        } else {
          results.failed++;
          results.errors.push({ guildId: guild.id, error: "Failed to fetch from Discord" });
        }

        // Small delay to avoid rate limiting (50ms between requests)
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        results.failed++;
        results.errors.push({ guildId: guild.id, error: error.message });
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
