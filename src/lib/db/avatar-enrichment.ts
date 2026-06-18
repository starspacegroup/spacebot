/**
 * Shared avatar enrichment helpers.
 *
 * Fallback priority:
 * 1) Existing row avatar value
 * 2) Guild profile avatar from guild_members_cache (guild avatar URL)
 * 3) User avatar from guild_members_cache
 * 4) User avatar from users table
 */

import { log } from "../log.js";

export function buildGuildAvatarUrl(guildId, userId, avatarHash, size = 64) {
  if (!guildId || !userId || !avatarHash) return null;
  const ext = String(avatarHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=${size}`;
}

async function getGuildMembersByUserId(db, guildId, userIds) {
  if (!db || !guildId || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT user_id, username, discriminator, avatar, guild_avatar
    FROM guild_members_cache
    WHERE guild_id = ? AND user_id IN (${placeholders})
  `).bind(guildId, ...userIds).all();

  return new Map((result?.results || []).map((member) => [String(member.user_id), member]));
}

async function getUsersById(db, userIds) {
  if (!db || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT id, username, discriminator, avatar
    FROM users
    WHERE id IN (${placeholders})
  `).bind(...userIds).all();

  return new Map((result?.results || []).map((user) => [String(user.id), user]));
}

/**
 * Enrich row-based actor fields with avatar/name/discriminator fallbacks.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Array<object>} rows
 * @param {object} [fields]
 * @param {string} [fields.idField='actor_id']
 * @param {string} [fields.avatarField='actor_avatar']
 * @param {string} [fields.nameField='actor_name']
 * @param {string} [fields.discriminatorField='actor_discriminator']
 * @returns {Promise<Array<object>>}
 */
export async function enrichRowsWithActorAvatars(db, guildId, rows, fields: { idField?: string; avatarField?: string; nameField?: string; discriminatorField?: string } = {}) {
  if (!db || !guildId || !Array.isArray(rows) || rows.length === 0) {
    return rows || [];
  }

  const {
    idField = "actor_id",
    avatarField = "actor_avatar",
    nameField = "actor_name",
    discriminatorField = "actor_discriminator",
  } = fields;

  const userIds = [...new Set(
    rows
      .map((row) => String(row?.[idField] || "").trim())
      .filter(Boolean),
  )];

  if (userIds.length === 0) return rows;

  try {
    const [memberById, userById] = await Promise.all([
      getGuildMembersByUserId(db, guildId, userIds),
      getUsersById(db, userIds),
    ]);

    return rows.map((row) => {
      const userId = String(row?.[idField] || "").trim();
      if (!userId) return row;

      const member = memberById.get(userId);
      const user = userById.get(userId);

      const guildAvatarUrl = member?.guild_avatar
        ? buildGuildAvatarUrl(guildId, userId, member.guild_avatar, 64)
        : null;

      const enriched = {
        ...row,
        [avatarField]: row?.[avatarField] || guildAvatarUrl || member?.avatar || user?.avatar || null,
        [nameField]: row?.[nameField] || member?.username || user?.username || "Unknown User",
      };

      if (discriminatorField) {
        enriched[discriminatorField] =
          row?.[discriminatorField] || member?.discriminator || user?.discriminator || "0";
      }

      return enriched;
    });
  } catch (error) {
    log.debug(`[AvatarEnrichment] Skipping enrichment for guild ${guildId}:`, error);
    return rows;
  }
}
