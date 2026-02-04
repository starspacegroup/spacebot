/**
 * Cloudflare Pages Functions - Scheduled Event Handler
 * 
 * This file handles cron triggers defined in wrangler.toml
 * Cloudflare Pages will automatically pick up this export.
 * 
 * Cron schedules:
 * - "0 * * * *" = Every hour (stats aggregation from event logs)
 * - "0 0 * * *" = Daily at midnight (Discord API refresh + cleanup)
 */

/**
 * Get all guilds that have event logs
 * @param {D1Database} db
 * @returns {Promise<string[]>}
 */
async function getGuildsWithLogs(db) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT DISTINCT guild_id 
      FROM event_logs 
      WHERE created_at >= datetime('now', '-7 days')
    `).all();

    return result.results?.map(r => r.guild_id) || [];
  } catch (error) {
    console.error("[Scheduled] Failed to get guilds with logs:", error);
    return [];
  }
}

/**
 * Get processing checkpoint for a guild
 */
async function getCheckpoint(db, guildId, checkpointType) {
  try {
    const result = await db.prepare(`
      SELECT last_processed_event_id, last_processed_at
      FROM stats_processing_checkpoint
      WHERE guild_id = ? AND checkpoint_type = ?
    `).bind(guildId, checkpointType).first();

    return {
      lastEventId: result?.last_processed_event_id || 0,
      lastProcessedAt: result?.last_processed_at || null,
    };
  } catch {
    return { lastEventId: 0, lastProcessedAt: null };
  }
}

/**
 * Update processing checkpoint
 */
async function updateCheckpoint(db, guildId, checkpointType, lastEventId) {
  await db.prepare(`
    INSERT INTO stats_processing_checkpoint (guild_id, checkpoint_type, last_processed_event_id, last_processed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, checkpoint_type) 
    DO UPDATE SET last_processed_event_id = ?, last_processed_at = datetime('now')
  `).bind(guildId, checkpointType, lastEventId, lastEventId).run();
}

/**
 * Process voice sessions from VOICE_JOIN/VOICE_LEAVE events
 */
async function processVoiceSessions(db, guildId) {
  const checkpoint = await getCheckpoint(db, guildId, "voice_sessions");
  
  const events = await db.prepare(`
    SELECT id, event_type, actor_id, channel_id, channel_name, created_at
    FROM event_logs
    WHERE guild_id = ? 
      AND id > ?
      AND event_type IN ('VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE')
    ORDER BY id ASC
    LIMIT 1000
  `).bind(guildId, checkpoint.lastEventId).all();

  if (!events.results?.length) {
    return { processed: 0, sessionsCreated: 0, sessionsClosed: 0 };
  }

  let sessionsCreated = 0;
  let sessionsClosed = 0;
  let lastEventId = checkpoint.lastEventId;

  for (const event of events.results) {
    lastEventId = event.id;

    if (event.event_type === "VOICE_JOIN") {
      await db.prepare(`
        INSERT INTO voice_sessions (guild_id, user_id, channel_id, channel_name, joined_at, join_event_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(guildId, event.actor_id, event.channel_id, event.channel_name, event.created_at, event.id).run();
      sessionsCreated++;
    } else if (event.event_type === "VOICE_LEAVE") {
      const result = await db.prepare(`
        UPDATE voice_sessions
        SET 
          left_at = ?,
          leave_event_id = ?,
          duration_seconds = CAST((julianday(?) - julianday(joined_at)) * 86400 AS INTEGER)
        WHERE guild_id = ? 
          AND user_id = ? 
          AND left_at IS NULL
          AND id = (
            SELECT id FROM voice_sessions 
            WHERE guild_id = ? AND user_id = ? AND left_at IS NULL
            ORDER BY joined_at DESC
            LIMIT 1
          )
      `).bind(event.created_at, event.id, event.created_at, guildId, event.actor_id, guildId, event.actor_id).run();
      
      if (result.meta?.changes > 0) sessionsClosed++;
    } else if (event.event_type === "VOICE_MOVE") {
      await db.prepare(`
        UPDATE voice_sessions
        SET 
          left_at = ?,
          duration_seconds = CAST((julianday(?) - julianday(joined_at)) * 86400 AS INTEGER)
        WHERE guild_id = ? AND user_id = ? AND left_at IS NULL
      `).bind(event.created_at, event.created_at, guildId, event.actor_id).run();
      sessionsClosed++;

      await db.prepare(`
        INSERT INTO voice_sessions (guild_id, user_id, channel_id, channel_name, joined_at, join_event_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(guildId, event.actor_id, event.channel_id, event.channel_name, event.created_at, event.id).run();
      sessionsCreated++;
    }
  }

  await updateCheckpoint(db, guildId, "voice_sessions", lastEventId);

  return { processed: events.results.length, sessionsCreated, sessionsClosed };
}

/**
 * Build hourly aggregated statistics for a guild
 */
async function buildHourlyStats(db, guildId) {
  try {
    // First, process any new voice sessions
    await processVoiceSessions(db, guildId);

    // Get the last fully processed hour
    const lastAggregated = await db.prepare(`
      SELECT MAX(period_end) as last_period
      FROM aggregated_stats
      WHERE guild_id = ? AND period_type = 'hourly'
    `).bind(guildId).first();

    let startTime;
    if (lastAggregated?.last_period) {
      startTime = lastAggregated.last_period;
    } else {
      const earliest = await db.prepare(`
        SELECT MIN(created_at) as earliest
        FROM event_logs
        WHERE guild_id = ? AND created_at >= datetime('now', '-7 days')
      `).bind(guildId).first();
      
      startTime = earliest?.earliest || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    const hoursToProcess = await db.prepare(`
      SELECT DISTINCT 
        strftime('%Y-%m-%d %H:00:00', created_at) as period_start,
        strftime('%Y-%m-%d %H:00:00', created_at, '+1 hour') as period_end
      FROM event_logs
      WHERE guild_id = ? 
        AND created_at >= ?
        AND created_at < strftime('%Y-%m-%d %H:00:00', 'now')
      ORDER BY period_start ASC
    `).bind(guildId, startTime).all();

    if (!hoursToProcess.results?.length) {
      return { success: true, periodsProcessed: 0, eventsProcessed: 0 };
    }

    let totalEventsProcessed = 0;
    let periodsProcessed = 0;

    for (const period of hoursToProcess.results) {
      const existing = await db.prepare(`
        SELECT id FROM aggregated_stats
        WHERE guild_id = ? AND period_type = 'hourly' AND period_start = ?
      `).bind(guildId, period.period_start).first();

      if (existing) continue;

      // Aggregate member events
      const memberStats = await db.prepare(`
        SELECT 
          SUM(CASE WHEN event_type = 'MEMBER_JOIN' THEN 1 ELSE 0 END) as joins,
          SUM(CASE WHEN event_type = 'MEMBER_LEAVE' THEN 1 ELSE 0 END) as leaves
        FROM event_logs
        WHERE guild_id = ? AND created_at >= ? AND created_at < ?
          AND event_type IN ('MEMBER_JOIN', 'MEMBER_LEAVE')
      `).bind(guildId, period.period_start, period.period_end).first();

      // Aggregate voice activity from sessions
      const voiceStats = await db.prepare(`
        SELECT 
          COUNT(DISTINCT user_id) as unique_users,
          SUM(
            CASE 
              WHEN left_at IS NULL THEN 
                CAST((julianday(?) - julianday(MAX(joined_at, ?))) * 86400 AS INTEGER)
              WHEN left_at > ? AND joined_at < ? THEN
                CAST((julianday(MIN(left_at, ?)) - julianday(MAX(joined_at, ?))) * 86400 AS INTEGER)
              ELSE 0
            END
          ) as total_seconds
        FROM voice_sessions
        WHERE guild_id = ? AND joined_at < ? AND (left_at IS NULL OR left_at > ?)
      `).bind(
        period.period_end, period.period_start,
        period.period_start, period.period_end,
        period.period_end, period.period_start,
        guildId, period.period_end, period.period_start
      ).first();

      // Calculate peak concurrent voice users
      const peakConcurrent = await db.prepare(`
        WITH voice_events AS (
          SELECT 
            created_at as event_time,
            CASE 
              WHEN event_type = 'VOICE_JOIN' THEN 1
              WHEN event_type = 'VOICE_LEAVE' THEN -1
              ELSE 0
            END as delta
          FROM event_logs
          WHERE guild_id = ?
            AND created_at >= ?
            AND created_at < ?
            AND event_type IN ('VOICE_JOIN', 'VOICE_LEAVE')
        ),
        running_count AS (
          SELECT 
            event_time,
            SUM(delta) OVER (ORDER BY event_time ROWS UNBOUNDED PRECEDING) as concurrent
          FROM voice_events
        )
        SELECT COALESCE(MAX(concurrent), 0) as peak
        FROM running_count
      `).bind(guildId, period.period_start, period.period_end).first();

      // Aggregate message activity
      const messageStats = await db.prepare(`
        SELECT COUNT(*) as count, COUNT(DISTINCT actor_id) as unique_users
        FROM event_logs
        WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND event_type = 'MESSAGE_CREATE'
      `).bind(guildId, period.period_start, period.period_end).first();

      // Total events
      const totalEvents = await db.prepare(`
        SELECT COUNT(*) as count, MAX(id) as last_id
        FROM event_logs
        WHERE guild_id = ? AND created_at >= ? AND created_at < ?
      `).bind(guildId, period.period_start, period.period_end).first();

      // Insert aggregated stats
      await db.prepare(`
        INSERT INTO aggregated_stats (
          guild_id, period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, last_event_id
        ) VALUES (?, 'hourly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        guildId, period.period_start, period.period_end,
        memberStats?.joins || 0, memberStats?.leaves || 0,
        (memberStats?.joins || 0) - (memberStats?.leaves || 0),
        voiceStats?.total_seconds || 0, voiceStats?.unique_users || 0,
        peakConcurrent?.peak || 0,
        messageStats?.count || 0, messageStats?.unique_users || 0,
        totalEvents?.count || 0, totalEvents?.last_id || null
      ).run();

      totalEventsProcessed += totalEvents?.count || 0;
      periodsProcessed++;
    }

    return { success: true, periodsProcessed, eventsProcessed: totalEventsProcessed };
  } catch (error) {
    console.error(`[Scheduled] Failed to build hourly stats for ${guildId}:`, error);
    return { success: false, periodsProcessed: 0, eventsProcessed: 0, error: error.message };
  }
}

/**
 * Build daily aggregated statistics by rolling up hourly data
 */
async function buildDailyStats(db, guildId) {
  try {
    const lastAggregated = await db.prepare(`
      SELECT MAX(period_end) as last_period
      FROM aggregated_stats
      WHERE guild_id = ? AND period_type = 'daily'
    `).bind(guildId).first();

    const daysToProcess = await db.prepare(`
      SELECT 
        strftime('%Y-%m-%d 00:00:00', period_start) as day_start,
        strftime('%Y-%m-%d 00:00:00', period_start, '+1 day') as day_end,
        COUNT(*) as hour_count
      FROM aggregated_stats
      WHERE guild_id = ? 
        AND period_type = 'hourly'
        AND period_start >= COALESCE(?, datetime('now', '-30 days'))
        AND period_start < strftime('%Y-%m-%d 00:00:00', 'now')
      GROUP BY strftime('%Y-%m-%d', period_start)
      HAVING hour_count >= 1
      ORDER BY day_start ASC
    `).bind(guildId, lastAggregated?.last_period).all();

    if (!daysToProcess.results?.length) {
      return { success: true, periodsProcessed: 0 };
    }

    let periodsProcessed = 0;

    for (const day of daysToProcess.results) {
      const existing = await db.prepare(`
        SELECT id FROM aggregated_stats
        WHERE guild_id = ? AND period_type = 'daily' AND period_start = ?
      `).bind(guildId, day.day_start).first();

      if (existing) continue;

      const dayStats = await db.prepare(`
        SELECT 
          SUM(member_joins) as member_joins,
          SUM(member_leaves) as member_leaves,
          SUM(voice_total_seconds) as voice_total_seconds,
          MAX(voice_unique_users) as voice_unique_users,
          MAX(voice_peak_concurrent) as voice_peak_concurrent,
          SUM(message_count) as message_count,
          MAX(message_unique_users) as message_unique_users,
          SUM(total_events) as total_events,
          MAX(last_event_id) as last_event_id
        FROM aggregated_stats
        WHERE guild_id = ? AND period_type = 'hourly' AND period_start >= ? AND period_start < ?
      `).bind(guildId, day.day_start, day.day_end).first();

      await db.prepare(`
        INSERT INTO aggregated_stats (
          guild_id, period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, last_event_id
        ) VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        guildId, day.day_start, day.day_end,
        dayStats?.member_joins || 0, dayStats?.member_leaves || 0,
        (dayStats?.member_joins || 0) - (dayStats?.member_leaves || 0),
        dayStats?.voice_total_seconds || 0, dayStats?.voice_unique_users || 0,
        dayStats?.voice_peak_concurrent || 0,
        dayStats?.message_count || 0, dayStats?.message_unique_users || 0,
        dayStats?.total_events || 0, dayStats?.last_event_id || null
      ).run();

      periodsProcessed++;
    }

    return { success: true, periodsProcessed };
  } catch (error) {
    console.error(`[Scheduled] Failed to build daily stats for ${guildId}:`, error);
    return { success: false, periodsProcessed: 0, error: error.message };
  }
}

/**
 * Clean up old data
 */
async function cleanupOldData(db) {
  try {
    const sessionsResult = await db.prepare(`
      DELETE FROM voice_sessions WHERE left_at IS NOT NULL AND left_at < datetime('now', '-90 days')
    `).run();

    const hourlyResult = await db.prepare(`
      DELETE FROM aggregated_stats WHERE period_type = 'hourly' AND period_start < datetime('now', '-30 days')
    `).run();

    return {
      sessionsDeleted: sessionsResult.meta?.changes || 0,
      aggregatesDeleted: hourlyResult.meta?.changes || 0,
    };
  } catch (error) {
    console.error("[Scheduled] Failed to cleanup old data:", error);
    return { sessionsDeleted: 0, aggregatesDeleted: 0 };
  }
}

/**
 * Fetch guild stats from Discord API
 */
async function fetchGuildStatsFromDiscord(botToken, guildId) {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (!response.ok) return null;

    const guild = await response.json();
    
    return {
      member_count: guild.approximate_member_count || guild.member_count || 0,
      online_count: guild.approximate_presence_count || null,
      channel_count: null,
      role_count: guild.roles?.length || null,
      emoji_count: guild.emojis?.length || null,
      boost_count: guild.premium_subscription_count || 0,
      boost_level: guild.premium_tier || 0,
    };
  } catch (error) {
    console.error(`[Scheduled] Failed to fetch guild ${guildId} from Discord:`, error);
    return null;
  }
}

/**
 * Get all guilds the bot is in
 */
async function getBotGuilds(botToken) {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error("[Scheduled] Failed to fetch bot guilds:", error);
    return [];
  }
}

/**
 * Hourly job: Aggregate stats from event logs
 */
async function runHourlyAggregation(env) {
  const db = env.DB;
  if (!db) {
    console.warn("[Scheduled] Database not available for hourly aggregation");
    return { success: false, error: "Database not available" };
  }

  const startTime = Date.now();
  const guilds = await getGuildsWithLogs(db);

  if (guilds.length === 0) {
    console.log("[Scheduled] No guilds with recent activity for hourly aggregation");
    return { success: true, guildsProcessed: 0 };
  }

  const results = {
    guildsProcessed: 0,
    guildsFailed: 0,
    totalHourlyPeriods: 0,
    totalDailyPeriods: 0,
  };

  for (const guildId of guilds) {
    try {
      const hourly = await buildHourlyStats(db, guildId);
      const daily = await buildDailyStats(db, guildId);
      
      if (hourly.success) {
        results.guildsProcessed++;
        results.totalHourlyPeriods += hourly.periodsProcessed;
        results.totalDailyPeriods += daily.periodsProcessed;
      } else {
        results.guildsFailed++;
      }
    } catch (error) {
      results.guildsFailed++;
      console.error(`[Scheduled] Failed to aggregate stats for ${guildId}:`, error);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Scheduled] Hourly aggregation completed: ${results.guildsProcessed} guilds, ${results.totalHourlyPeriods} hourly periods in ${duration}ms`);

  return { success: true, ...results, duration };
}

/**
 * Daily job: Refresh stats from Discord API and cleanup old data
 */
async function runDailyRefresh(env) {
  const db = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;

  if (!db || !botToken) {
    console.warn("[Scheduled] Missing db or bot token for daily refresh");
    return { success: false, error: "Missing configuration" };
  }

  const startTime = Date.now();
  const guilds = await getBotGuilds(botToken);

  if (guilds.length === 0) {
    return { success: true, guildsProcessed: 0 };
  }

  const results = { processed: 0, failed: 0 };

  for (const guild of guilds) {
    try {
      const stats = await fetchGuildStatsFromDiscord(botToken, guild.id);
      
      if (stats) {
        await db.prepare(`
          INSERT INTO server_stats (
            guild_id, member_count, online_count, bot_count,
            channel_count, role_count, emoji_count, boost_count, boost_level
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guild.id, stats.member_count, stats.online_count, stats.bot_count,
          stats.channel_count, stats.role_count, stats.emoji_count,
          stats.boost_count, stats.boost_level
        ).run();
        results.processed++;
      } else {
        results.failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      results.failed++;
    }
  }

  // Cleanup old data
  const cleanup = await cleanupOldData(db);
  
  // Prune old server_stats
  await db.prepare(`DELETE FROM server_stats WHERE recorded_at < datetime('now', '-90 days')`).run();

  const duration = Date.now() - startTime;
  console.log(`[Scheduled] Daily refresh completed: ${results.processed} guilds in ${duration}ms`);

  return { success: true, ...results, cleanup, duration };
}

/**
 * Cloudflare scheduled event handler
 * 
 * @param {ScheduledEvent} event
 * @param {Object} env
 * @param {ExecutionContext} ctx
 */
export async function onScheduled(event, env, ctx) {
  const cronPattern = event.cron;
  
  console.log(`[Scheduled] Running cron job: ${cronPattern} at ${new Date().toISOString()}`);

  try {
    if (cronPattern === "0 * * * *") {
      // Hourly job - aggregate stats
      const result = await runHourlyAggregation(env);
      console.log("[Scheduled] Hourly aggregation result:", JSON.stringify(result));
    } else if (cronPattern === "0 0 * * *") {
      // Daily job - also run aggregation first, then refresh and cleanup
      const aggregationResult = await runHourlyAggregation(env);
      const refreshResult = await runDailyRefresh(env);
      console.log("[Scheduled] Daily job results:", JSON.stringify({ aggregation: aggregationResult, refresh: refreshResult }));
    } else {
      console.warn(`[Scheduled] Unknown cron pattern: ${cronPattern}`);
    }
  } catch (error) {
    console.error(`[Scheduled] Cron job failed for ${cronPattern}:`, error);
    throw error;
  }
}

// Export for Cloudflare Pages Functions
export default {
  scheduled: onScheduled,
};
