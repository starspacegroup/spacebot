/**
 * API endpoint for recording and retrieving server statistics
 *
 * GET /api/stats/[guildId] - Get server stats history. Needs either an API key with the
 *   stats:read scope that belongs to THIS guild (Authorization: Bearer sb_live_...), or a
 *   signed-in admin of the guild. It used to be open to anyone.
 * POST /api/stats/[guildId] - Record new stats snapshot (requires bot token or cron secret)
 */

import { json } from '@sveltejs/kit';
import {
	recordServerStats,
	getServerStatsHistory,
	getMemberCountChanges,
	getPeakMemberCount,
	getLatestServerStats,
	fetchGuildStatsFromDiscord,
} from '$lib/db/server-stats.js';
import { log } from '$lib/log.js';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';

const PERIOD = /^(24h|1y|all|\d{1,4}d)$/;
const GRANULARITIES = new Set(['auto', 'hourly', 'daily', 'weekly']);

/**
 * Who may read a guild's stats: a key for that guild with stats:read, or a guild admin.
 * A key for another guild is refused, so one server's key cannot read another's numbers.
 */
async function canReadStats(request, cookies, platform, guildId) {
	if (request.headers.get('Authorization')) {
		const auth = await authenticateApiKey(request, platform);
		if (!auth.authenticated)
			return { ok: false, status: auth.status || 401, error: auth.error };
		if (!hasScope(auth, 'stats:read')) {
			return { ok: false, status: 403, error: 'Insufficient scope. Required: stats:read' };
		}
		if (auth.guildId !== guildId) {
			return { ok: false, status: 403, error: 'This API key belongs to a different server' };
		}
		return { ok: true };
	}
	const admin = await verifyGuildAdmin(guildId, cookies?.get('discord_access_token'), cookies);
	if (admin.authorized) return { ok: true };
	return {
		ok: false,
		status: 401,
		error: 'Authentication required. Use an API key with stats:read.',
	};
}

/**
 * Verify the request has proper authorization
 */
function verifyAuth(request, platform) {
	// Check for cron secret (for scheduled jobs)
	const cronSecret = (platform as any)?.env?.CRON_SECRET || process.env.CRON_SECRET;
	const authHeader = request.headers.get('Authorization');

	if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
		return { authorized: true, type: 'cron' };
	}

	// Check for internal request header (from our own app)
	const internalKey = (platform as any)?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
	if (internalKey && authHeader === `Bearer ${internalKey}`) {
		return { authorized: true, type: 'internal' };
	}

	return { authorized: false };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, platform, request, cookies }) {
	const { guildId } = params;

	if (!guildId) {
		return json({ error: 'Guild ID required' }, { status: 400 });
	}

	const access = await canReadStats(request, cookies, platform, guildId);
	if (!access.ok) {
		return json({ error: access.error }, { status: access.status });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	// Get query parameters
	const period = url.searchParams.get('period') || '7d';
	const granularity = url.searchParams.get('granularity') || 'auto';
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
		const [history, changes, peak, latest] = await Promise.all([
			getServerStatsHistory(db, guildId, { period, granularity }),
			getMemberCountChanges(db, guildId),
			getPeakMemberCount(db, guildId, period),
			getLatestServerStats(db, guildId),
		]);

		return json({
			success: true,
			guildId,
			period,
			current: {
				memberCount: latest?.member_count ?? changes.current,
				humanCount: latest?.human_count ?? changes.currentHuman ?? null,
				onlineCount: latest?.online_count ?? null,
				botCount: latest?.bot_count ?? changes.botCount ?? null,
				boostCount: latest?.boost_count ?? null,
				boostLevel: latest?.boost_level ?? null,
				lastUpdated: latest?.recorded_at || null,
			},
			changes: {
				day: changes.day,
				week: changes.week,
				month: changes.month,
				dayHuman: changes.dayHuman,
				weekHuman: changes.weekHuman,
				monthHuman: changes.monthHuman,
			},
			peak: {
				count: peak.peak,
				date: peak.peakDate,
			},
			history,
		});
	} catch (error) {
		log.error('Failed to get server stats:', error);
		return json({ error: 'Failed to fetch statistics' }, { status: 500 });
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
	const { guildId } = params;

	if (!guildId) {
		return json({ error: 'Guild ID required' }, { status: 400 });
	}

	// Verify authorization
	const auth = verifyAuth(request, platform);
	if (!auth.authorized) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	try {
		// Check if stats were provided in the request body
		let stats;
		const contentType = request.headers.get('content-type');

		if (contentType?.includes('application/json')) {
			const body = await request.json();
			if (body.member_count !== undefined) {
				stats = body;
			}
		}

		// If no stats provided, fetch from Discord API
		if (!stats) {
			const fetchResult = await fetchGuildStatsFromDiscord(botToken, guildId);
			if (!fetchResult) {
				return json({ error: 'Failed to fetch guild stats from Discord' }, { status: 502 });
			}
			stats = fetchResult.stats;
		}

		// Record the stats
		const result = await recordServerStats(db, guildId, stats);

		if (!result.success) {
			return json({ error: result.error }, { status: 500 });
		}

		return json({
			success: true,
			guildId,
			recorded: stats,
			source: auth.type,
		});
	} catch (error) {
		log.error('Failed to record server stats:', error);
		return json({ error: 'Failed to record statistics' }, { status: 500 });
	}
}
