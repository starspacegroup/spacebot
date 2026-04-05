/**
 * Users Database Module
 *
 * Tracks Discord users who have logged in via OAuth.
 * Provides CRUD operations for the superadmin user management panel.
 */

import { log } from "./logger.js";

/**
 * Upsert a user record on login.
 * Called when a user authenticates via Discord OAuth.
 *
 * @param {D1Database} db
 * @param {object} userData
 * @param {string} userData.id - Discord user ID
 * @param {string} userData.username
 * @param {string} [userData.global_name]
 * @param {string} [userData.avatar]
 * @param {string} [userData.discriminator]
 * @param {string} [userData.email]
 * @param {boolean} [userData.is_superadmin]
 * @returns {Promise<{success: boolean, isNewUser?: boolean, error?: string}>}
 */
export async function upsertUser(db, userData) {
  if (!db || !userData?.id) {
    return { success: false, error: "Missing database or user data" };
  }

  try {
    const existingUser = await db
      .prepare("SELECT id FROM users WHERE id = ?")
      .bind(userData.id)
      .first();

    await db
      .prepare(`
        INSERT INTO users (
          id, username, global_name, avatar, discriminator, email,
          is_superadmin, last_login_at, login_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          global_name = excluded.global_name,
          avatar = excluded.avatar,
          discriminator = excluded.discriminator,
          email = COALESCE(excluded.email, users.email),
          is_superadmin = excluded.is_superadmin,
          last_login_at = datetime('now'),
          login_count = users.login_count + 1,
          updated_at = datetime('now')
      `)
      .bind(
        userData.id,
        userData.username || "Unknown",
        userData.global_name || null,
        userData.avatar || null,
        userData.discriminator || "0",
        userData.email || null,
        userData.is_superadmin ? 1 : 0,
      )
      .run();

    log.debug(`[Users] Upserted user ${userData.id} (${userData.username})`);
    return { success: true, isNewUser: !existingUser };
  } catch (error) {
    log.error("[Users] Error upserting user:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get a single user by ID.
 *
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getUser(db, userId) {
  if (!db || !userId) return null;

  try {
    return await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();
  } catch (error) {
    log.error("[Users] Error getting user:", userId, error);
    return null;
  }
}

/**
 * Get all tracked users, with optional search/filter.
 *
 * @param {D1Database} db
 * @param {object} [opts]
 * @param {string} [opts.search] - Search username/global_name
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @param {string} [opts.sort] - Column to sort by
 * @param {string} [opts.order] - 'asc' or 'desc'
 * @returns {Promise<{users: object[], total: number}>}
 */
export async function listUsers(db, opts = {}) {
  if (!db) return { users: [], total: 0 };

  const limit = opts.limit || 50;
  const offset = opts.offset || 0;
  const sort = opts.sort || "last_login_at";
  const order = opts.order === "asc" ? "ASC" : "DESC";

  // Whitelist allowed sort columns
  const allowedSort = ["username", "last_login_at", "login_count", "created_at", "id"];
  const sortCol = allowedSort.includes(sort) ? sort : "last_login_at";

  try {
    let whereClause = "";
    const binds = [];

    if (opts.search) {
      whereClause = "WHERE username LIKE ? OR global_name LIKE ? OR id = ?";
      const pattern = `%${opts.search}%`;
      binds.push(pattern, pattern, opts.search);
    }

    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`)
      .bind(...binds)
      .first();

    const result = await db
      .prepare(
        `SELECT * FROM users ${whereClause} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...binds, limit, offset)
      .all();

    return {
      users: result?.results || [],
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("[Users] Error listing users:", error);
    return { users: [], total: 0 };
  }
}

/**
 * Update a user record (superadmin only).
 *
 * @param {D1Database} db
 * @param {string} userId
 * @param {object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateUser(db, userId, updates) {
  if (!db || !userId) {
    return { success: false, error: "Missing database or user ID" };
  }

  // Whitelist updateable fields
  const allowed = ["username", "global_name", "avatar", "email", "notes", "banned", "is_superadmin"];
  const sets = [];
  const binds = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      binds.push(key === "banned" || key === "is_superadmin" ? (value ? 1 : 0) : value);
    }
  }

  if (sets.length === 0) {
    return { success: false, error: "No valid fields to update" };
  }

  sets.push("updated_at = datetime('now')");
  binds.push(userId);

  try {
    await db
      .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

    log.info(`[Users] Updated user ${userId}:`, Object.keys(updates));
    return { success: true };
  } catch (error) {
    log.error("[Users] Error updating user:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete a user record.
 *
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteUser(db, userId) {
  if (!db || !userId) {
    return { success: false, error: "Missing database or user ID" };
  }

  try {
    await db
      .prepare("DELETE FROM users WHERE id = ?")
      .bind(userId)
      .run();

    log.info(`[Users] Deleted user ${userId}`);
    return { success: true };
  } catch (error) {
    log.error("[Users] Error deleting user:", error);
    return { success: false, error: error.message || String(error) };
  }
}
