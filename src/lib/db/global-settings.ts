/**
 * Global Settings Database Helper
 *
 * Simple key-value store for superadmin-level configuration.
 */

import { log } from '$lib/log.js';

/**
 * Get a global setting by key
 * @param {D1Database} db
 * @param {string} key
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
export async function getGlobalSetting(db, key, defaultValue = null) {
	if (!db) return defaultValue;

	try {
		const row = await db
			.prepare('SELECT value FROM global_settings WHERE key = ?')
			.bind(key)
			.first();

		return row?.value ?? defaultValue;
	} catch (error) {
		log.error('[GlobalSettings] Failed to get:', error);
		return defaultValue;
	}
}

/**
 * Get several global settings in a single query.
 *
 * Hot paths (the gateway's config poll) used to fan out one
 * `getGlobalSetting` call per key, which multiplied a once-per-poll read into
 * six D1 queries. Prefer this whenever more than one key is needed at once.
 *
 * @param {D1Database} db
 * @param {string[]} keys
 * @returns {Promise<Map<string, string|null>>} every requested key, missing ones mapped to null
 */
export async function getGlobalSettings(db, keys = []) {
	const uniqueKeys = [...new Set(keys.filter(Boolean))];
	const values = new Map(uniqueKeys.map((key) => [key, null]));

	if (!db || uniqueKeys.length === 0) return values;

	try {
		const placeholders = uniqueKeys.map(() => '?').join(', ');
		const result = await db
			.prepare(`SELECT key, value FROM global_settings WHERE key IN (${placeholders})`)
			.bind(...uniqueKeys)
			.all();

		for (const row of result?.results || []) {
			values.set(String(row.key), row.value ?? null);
		}

		return values;
	} catch (error) {
		log.error('[GlobalSettings] Failed to get many:', error);
		return values;
	}
}

/**
 * Set a global setting
 * @param {D1Database} db
 * @param {string} key
 * @param {string} value
 */
export async function setGlobalSetting(db, key, value) {
	if (!db) return { success: false, error: 'Database not available' };

	try {
		await db
			.prepare(
				`
			INSERT INTO global_settings (key, value, updated_at)
			VALUES (?, ?, datetime('now'))
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
		`
			)
			.bind(key, value)
			.run();

		return { success: true };
	} catch (error) {
		log.error('[GlobalSettings] Failed to set:', error);
		return { success: false, error: error.message };
	}
}
