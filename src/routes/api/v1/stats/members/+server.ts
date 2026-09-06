/**
 * External API v1 - Member count over time
 *
 * GET /api/v1/stats/members?period=30d&granularity=auto
 *
 * The series behind a member-count graph: one point per bucket, each the LAST
 * snapshot recorded in that bucket, from the same `server_stats` table the admin
 * dashboard charts. `period` accepts 24h, Nd (e.g. 7d, 30d, 90d), 1y or all;
 * `granularity` accepts hourly, daily, weekly or auto (hourly up to 2 days, daily
 * to 60, weekly beyond). Retention prunes snapshots older than 90 days, so a
 * longer period returns what is left, not an error.
 *
 * Requires scope: stats:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getServerStatsHistory } from '$lib/db/server-stats.js';
import { log } from '$lib/db/logger.js';

const PERIOD = /^(24h|1y|all|\d{1,4}d)$/;
const GRANULARITIES = new Set(['auto', 'hourly', 'daily', 'weekly']);

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'stats:read')) {
		return json({ error: 'Insufficient scope. Required: stats:read' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	const period = url.searchParams.get('period') || '30d';
	const granularity = url.searchParams.get('granularity') || 'auto';

	// Validate here rather than trusting the helper's fallback: a typo that
	// silently becomes "7 days" is the kind of answer a caller graphs without
	// noticing.
	if (!PERIOD.test(period)) {
		return json({ error: 'Invalid period. Use 24h, <N>d, 1y or all' }, { status: 400 });
	}
	if (!GRANULARITIES.has(granularity)) {
		return json(
			{ error: 'Invalid granularity. Use auto, hourly, daily or weekly' },
			{ status: 400 }
		);
	}

	try {
		const rows = await getServerStatsHistory(db, auth.guildId, { period, granularity });

		const points = rows.map((row) => ({
			period: row.period,
			member_count: row.member_count,
			online_count: row.online_count ?? null,
			human_count: row.human_count ?? null,
			recorded_at: row.last_recorded,
		}));

		return json(
			{ guild_id: auth.guildId, period, granularity, points },
			// Snapshots land a few times a day; a minute of caching costs nothing
			// and keeps a busy graph from becoming a busy database.
			{ headers: { 'cache-control': 'private, max-age=60' } }
		);
	} catch (error) {
		log.error('[API v1] Error fetching member history:', error);
		return json({ error: 'Failed to fetch member history' }, { status: 500 });
	}
}
