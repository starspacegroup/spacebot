/**
 * Stats Data Export API
 * GET /api/stats/[guildId]/export - Export all stats data for a guild as JSON
 * 
 * Exports:
 * - server_stats: Historical server metric snapshots
 * - aggregated_stats: Pre-computed hourly/daily aggregates
 * - voice_sessions: Voice channel session tracking
 */

import { json } from "@sveltejs/kit";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { log } from "$lib/log.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    // Fetch all stats data in parallel
    const [serverStats, aggregatedStats, voiceSessions] = await Promise.all([
      db.prepare(`
        SELECT 
          member_count, online_count, bot_count, human_count,
          channel_count, role_count, emoji_count, boost_count, boost_level,
          recorded_at
        FROM server_stats
        WHERE guild_id = ?
        ORDER BY recorded_at ASC
      `).bind(guildId).all(),

      db.prepare(`
        SELECT 
          period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, processed_at
        FROM aggregated_stats
        WHERE guild_id = ?
        ORDER BY period_start ASC
      `).bind(guildId).all(),

      db.prepare(`
        SELECT 
          user_id, channel_id, channel_name,
          joined_at, left_at, duration_seconds
        FROM voice_sessions
        WHERE guild_id = ?
        ORDER BY joined_at ASC
      `).bind(guildId).all(),
    ]);

    const exportData = {
      format: "spacebot-stats",
      version: 1,
      exported_at: new Date().toISOString(),
      guild_id: guildId,
      counts: {
        server_stats: serverStats.results?.length || 0,
        aggregated_stats: aggregatedStats.results?.length || 0,
        voice_sessions: voiceSessions.results?.length || 0,
      },
      server_stats: serverStats.results || [],
      aggregated_stats: aggregatedStats.results || [],
      voice_sessions: voiceSessions.results || [],
    };

    return json(exportData);
  } catch (error) {
    log.error("Failed to export stats data:", error);
    return json({ error: "Failed to export stats data" }, { status: 500 });
  }
}
