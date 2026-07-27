import { log } from '$lib/log.js';

const DEFAULT_LOG_LIMIT = 150;
const MAX_LOG_LIMIT = 500;
const MAX_LOG_ROWS = 2000;

function clampLimit(limit) {
	const parsed = Number.parseInt(String(limit), 10);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_LOG_LIMIT;
	}
	return Math.min(Math.max(parsed, 1), MAX_LOG_LIMIT);
}

export async function recordGatewayLogs(db, entries = []) {
	if (!db) return { success: false, error: 'Database not available' };

	const normalizedEntries = entries
		.map((entry) => ({
			level: String(entry?.level || 'info').slice(0, 20),
			message: String(entry?.message || '').trim(),
			source: String(entry?.source || 'gateway').slice(0, 50),
			logged_at: entry?.logged_at || entry?.loggedAt || null,
		}))
		.filter((entry) => entry.message);

	if (normalizedEntries.length === 0) {
		return { success: true, count: 0 };
	}

	try {
		for (const entry of normalizedEntries) {
			await db
				.prepare(
					`
        INSERT INTO gateway_logs (level, message, source, logged_at, created_at)
        VALUES (?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
      `
				)
				.bind(entry.level, entry.message, entry.source, entry.logged_at)
				.run();
		}

		// Trim to a rolling window of the newest MAX_LOG_ROWS entries.
		//
		// This runs after every flush, so it has to be cheap. The obvious
		// `WHERE id NOT IN (SELECT id ... ORDER BY id DESC LIMIT ?)` form makes
		// SQLite scan the whole table *and* materialise the 2000-row subquery on
		// every call — ~4k rows read per flush, which was the single largest
		// source of D1 rows-read on the account.
		//
		// `id` is INTEGER PRIMARY KEY AUTOINCREMENT and we only ever delete a
		// contiguous prefix from the bottom, so the ids that survive stay
		// contiguous and `MAX(id) - MAX_LOG_ROWS` is an exact watermark. Both
		// halves are rowid seeks: one to find MAX(id), then a range delete.
		await db
			.prepare(
				`
      DELETE FROM gateway_logs
      WHERE id <= (SELECT MAX(id) FROM gateway_logs) - ?
    `
			)
			.bind(MAX_LOG_ROWS)
			.run();

		return { success: true, count: normalizedEntries.length };
	} catch (error) {
		log.error('[GatewayLogs] Failed to record logs:', error);
		return { success: false, error: error.message };
	}
}

export async function listGatewayLogs(
	db,
	options: { limit?: number; afterId?: number | string } = {}
) {
	if (!db) return [];

	const limit = clampLimit(options.limit);
	const afterId = Number.parseInt(String(options.afterId || ''), 10);
	const hasAfterId = Number.isFinite(afterId) && afterId > 0;

	try {
		const result = hasAfterId
			? await db
					.prepare(
						`
          SELECT id, level, message, source, logged_at, created_at
          FROM gateway_logs
          WHERE id > ?
          ORDER BY id ASC
          LIMIT ?
        `
					)
					.bind(afterId, limit)
					.all()
			: await db
					.prepare(
						`
          SELECT id, level, message, source, logged_at, created_at
          FROM gateway_logs
          ORDER BY id DESC
          LIMIT ?
        `
					)
					.bind(limit)
					.all();

		return result.results || [];
	} catch (error) {
		log.error('[GatewayLogs] Failed to list logs:', error);
		return [];
	}
}
