/**
 * Global Settings Database Helper
 * 
 * Simple key-value store for superadmin-level configuration.
 */

import { log } from "$lib/log.js";

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
		const row = await db.prepare(
			"SELECT value FROM global_settings WHERE key = ?"
		).bind(key).first();

		return row?.value ?? defaultValue;
	} catch (error) {
		log.error("[GlobalSettings] Failed to get:", error);
		return defaultValue;
	}
}

/**
 * Set a global setting
 * @param {D1Database} db
 * @param {string} key
 * @param {string} value
 */
export async function setGlobalSetting(db, key, value) {
	if (!db) return { success: false, error: "Database not available" };

	try {
		await db.prepare(`
			INSERT INTO global_settings (key, value, updated_at)
			VALUES (?, ?, datetime('now'))
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
		`).bind(key, value).run();

		return { success: true };
	} catch (error) {
		log.error("[GlobalSettings] Failed to set:", error);
		return { success: false, error: error.message };
	}
}
