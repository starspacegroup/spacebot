/**
 * Cheap "which guilds have events?" queries over `event_logs`.
 *
 * `SELECT DISTINCT guild_id FROM event_logs` reads every row of the largest
 * table in the database to produce a handful of ids. It was one of the top
 * causes of the 2026-07-27 D1 rows-read blowout — and the fix then was applied
 * to the cron copy while an identical copy in the MCP `list_guilds` tool was
 * missed, so it kept scanning for another week. Both now build their SQL from
 * here, because two hand-maintained copies of the same query is exactly how that
 * happened.
 *
 * The technique is a recursive "loose index scan": start at the smallest
 * guild_id, then repeatedly ask for the smallest one greater than the last. Each
 * step is a single seek on `idx_event_logs_guild_created`, so the cost is
 * O(number of guilds) instead of O(number of events).
 */

/** Every distinct guild_id in `event_logs`, one index seek per guild. */
export const DISTINCT_GUILD_IDS_SQL = `
	WITH RECURSIVE distinct_guild(guild_id) AS (
		SELECT MIN(guild_id) FROM event_logs
		UNION ALL
		SELECT (SELECT MIN(guild_id) FROM event_logs WHERE guild_id > d.guild_id)
		FROM distinct_guild d
		WHERE d.guild_id IS NOT NULL
	)
	SELECT guild_id FROM distinct_guild WHERE guild_id IS NOT NULL`;

/**
 * Distinct guild_ids that also have an event since `?`.
 *
 * The EXISTS is one further seek per guild rather than a scan of the window —
 * answering "recently active?" without walking the events themselves.
 */
export const GUILDS_WITH_RECENT_LOGS_SQL = `
	WITH RECURSIVE distinct_guild(guild_id) AS (
		SELECT MIN(guild_id) FROM event_logs
		UNION ALL
		SELECT (SELECT MIN(guild_id) FROM event_logs WHERE guild_id > d.guild_id)
		FROM distinct_guild d
		WHERE d.guild_id IS NOT NULL
	)
	SELECT guild_id
	FROM distinct_guild
	WHERE guild_id IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM event_logs e
			WHERE e.guild_id = distinct_guild.guild_id
				AND e.created_at >= datetime('now', ?)
		)`;
