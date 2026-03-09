/**
 * Stats Data Import API
 * POST /api/stats/[guildId]/import - Import stats data from a JSON export file
 * 
 * Imports:
 * - server_stats: Historical server metric snapshots
 * - aggregated_stats: Pre-computed hourly/daily aggregates
 * - voice_sessions: Voice channel session tracking
 * 
 * Uses INSERT OR IGNORE to avoid duplicates based on timestamps.
 */

import { json } from "@sveltejs/kit";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { log } from "$lib/log.js";

/**
 * Batch insert rows using D1 batch API for efficiency.
 * Returns the count of rows successfully inserted.
 */
async function batchInsert(db, statements) {
  if (statements.length === 0) return 0;

  // D1 batch limit is ~100 statements per batch
  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    try {
      const results = await db.batch(batch);
      for (const result of results) {
        if (result.meta?.changes) {
          totalInserted += result.meta.changes;
        }
      }
    } catch (error) {
      log.error(`Batch insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error);
      // Continue with remaining batches
    }
  }

  return totalInserted;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate format
    if (body.format !== "spacebot-stats") {
      return json({ error: "Invalid file format. Expected a SpaceBot stats export file." }, { status: 400 });
    }

    const results = {
      server_stats: { imported: 0, total: 0 },
      aggregated_stats: { imported: 0, total: 0 },
      voice_sessions: { imported: 0, total: 0 },
    };

    // Import server_stats
    if (body.server_stats && Array.isArray(body.server_stats)) {
      results.server_stats.total = body.server_stats.length;
      const statements = body.server_stats.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO server_stats (
            guild_id, member_count, online_count, bot_count, human_count,
            channel_count, role_count, emoji_count, boost_count, boost_level,
            recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.member_count || 0,
          row.online_count ?? null,
          row.bot_count ?? null,
          row.human_count ?? null,
          row.channel_count ?? null,
          row.role_count ?? null,
          row.emoji_count ?? null,
          row.boost_count ?? null,
          row.boost_level ?? null,
          row.recorded_at,
        )
      );
      results.server_stats.imported = await batchInsert(db, statements);
    }

    // Import aggregated_stats
    if (body.aggregated_stats && Array.isArray(body.aggregated_stats)) {
      results.aggregated_stats.total = body.aggregated_stats.length;
      const statements = body.aggregated_stats.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO aggregated_stats (
            guild_id, period_type, period_start, period_end,
            member_joins, member_leaves, member_net_change,
            voice_total_seconds, voice_unique_users, voice_peak_concurrent,
            message_count, message_unique_users,
            total_events, processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.period_type,
          row.period_start,
          row.period_end,
          row.member_joins || 0,
          row.member_leaves || 0,
          row.member_net_change || 0,
          row.voice_total_seconds || 0,
          row.voice_unique_users || 0,
          row.voice_peak_concurrent || 0,
          row.message_count || 0,
          row.message_unique_users || 0,
          row.total_events || 0,
          row.processed_at || new Date().toISOString(),
        )
      );
      results.aggregated_stats.imported = await batchInsert(db, statements);
    }

    // Import voice_sessions
    if (body.voice_sessions && Array.isArray(body.voice_sessions)) {
      results.voice_sessions.total = body.voice_sessions.length;
      const statements = body.voice_sessions.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO voice_sessions (
            guild_id, user_id, channel_id, channel_name,
            joined_at, left_at, duration_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.user_id,
          row.channel_id,
          row.channel_name ?? null,
          row.joined_at,
          row.left_at ?? null,
          row.duration_seconds ?? null,
        )
      );
      results.voice_sessions.imported = await batchInsert(db, statements);
    }

    const totalImported = results.server_stats.imported +
      results.aggregated_stats.imported +
      results.voice_sessions.imported;
    const totalRows = results.server_stats.total +
      results.aggregated_stats.total +
      results.voice_sessions.total;

    return json({
      success: true,
      message: `Imported ${totalImported} of ${totalRows} records`,
      results,
    });
  } catch (error) {
    log.error("Failed to import stats data:", error);
    return json({ error: "Failed to import stats data: " + (error.message || String(error)) }, { status: 500 });
  }
}
