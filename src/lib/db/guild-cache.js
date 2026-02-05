/**
 * Guild members and roles cache functions
 * 
 * Caches Discord guild members and roles in D1 for fast lookups
 * without hitting the Discord API. Updated periodically by cron job.
 */

import { log } from "$lib/log.js";

/**
 * @typedef {Object} CachedRole
 * @property {string} role_id
 * @property {string} name
 * @property {number} color
 * @property {number} position
 * @property {string} permissions
 * @property {boolean} hoist
 * @property {boolean} managed
 * @property {boolean} mentionable
 * @property {string|null} icon
 * @property {string|null} unicode_emoji
 * @property {string|null} bot_id - Bot user ID if this is a bot's managed role
 * @property {string|null} integration_id - Integration ID if managed by integration
 * @property {boolean} premium_subscriber - True if this is the boost role
 * @property {string|null} subscription_listing_id - For purchasable roles
 * @property {boolean} available_for_purchase - True if role is purchasable
 * @property {boolean} guild_connections - True if this is a linked role
 */

/**
 * @typedef {Object} CachedMember
 * @property {string} user_id
 * @property {string} username
 * @property {string} discriminator - Legacy discriminator (usually '0')
 * @property {string|null} global_name - Display name
 * @property {string|null} nickname - Server-specific nickname
 * @property {string|null} avatar - User avatar hash
 * @property {string|null} banner - User banner hash
 * @property {number|null} accent_color - User banner color
 * @property {string|null} guild_avatar - Server-specific avatar
 * @property {string|null} guild_banner - Server-specific banner
 * @property {boolean} is_bot
 * @property {boolean} is_system - True if official Discord system user
 * @property {boolean} is_owner
 * @property {number} flags - User public flags (badges)
 * @property {number} premium_type - Nitro type (0=none, 1=classic, 2=nitro, 3=basic)
 * @property {string|null} joined_at
 * @property {string|null} premium_since - When member started boosting
 * @property {boolean} pending - True if hasn't passed membership screening
 * @property {string|null} communication_disabled_until - Timeout expiration
 * @property {boolean} deaf - Server deafened
 * @property {boolean} mute - Server muted
 * @property {string[]} roles - Array of role IDs
 */

/**
 * Refresh the roles cache for a guild
 * @param {D1Database} db - D1 database
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Guild ID
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
export async function refreshRolesCache(db, botToken, guildId) {
  if (!db || !botToken || !guildId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    // Fetch roles from Discord
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/roles`,
      {
        headers: { Authorization: `Bot ${botToken}` },
      }
    );

    if (!response.ok) {
      const error = `Discord API error: ${response.status}`;
      log.error(`[RolesCache] ${error}`);
      return { success: false, error };
    }

    const roles = await response.json();
    
    // Clear existing roles for this guild and insert new ones
    await db.prepare("DELETE FROM guild_roles_cache WHERE guild_id = ?").bind(guildId).run();
    
    // Insert all roles with comprehensive data
    const stmt = db.prepare(`
      INSERT INTO guild_roles_cache 
        (guild_id, role_id, name, color, position, permissions, hoist, managed, mentionable, 
         icon, unicode_emoji, bot_id, integration_id, premium_subscriber, 
         subscription_listing_id, available_for_purchase, guild_connections, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const role of roles) {
      // Extract role tags if present
      const tags = role.tags || {};
      
      await stmt.bind(
        guildId,
        role.id,
        role.name,
        role.color || 0,
        role.position || 0,
        String(role.permissions || "0"),
        role.hoist ? 1 : 0,
        role.managed ? 1 : 0,
        role.mentionable ? 1 : 0,
        role.icon || null,
        role.unicode_emoji || null,
        tags.bot_id || null,
        tags.integration_id || null,
        tags.premium_subscriber !== undefined ? 1 : 0,
        tags.subscription_listing_id || null,
        tags.available_for_purchase !== undefined ? 1 : 0,
        tags.guild_connections !== undefined ? 1 : 0
      ).run();
    }

    log.debug(`[RolesCache] Cached ${roles.length} roles for guild ${guildId}`);
    return { success: true, count: roles.length };
  } catch (error) {
    log.error(`[RolesCache] Error refreshing roles for ${guildId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Refresh the members cache for a guild
 * Fetches all members with pagination
 * @param {D1Database} db - D1 database
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Guild ID
 * @param {string} [ownerId] - Guild owner ID (optional, for marking owner)
 * @returns {Promise<{success: boolean, count?: number, botCount?: number, humanCount?: number, error?: string}>}
 */
export async function refreshMembersCache(db, botToken, guildId, ownerId = null) {
  if (!db || !botToken || !guildId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const allMembers = [];
    let lastMemberId = null;
    const maxMembers = 50000; // Safety limit
    
    // Fetch all members with pagination
    while (allMembers.length < maxMembers) {
      const url = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`);
      url.searchParams.set("limit", "1000");
      if (lastMemberId) {
        url.searchParams.set("after", lastMemberId);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bot ${botToken}` },
      });

      if (!response.ok) {
        if (response.status === 403) {
          return { success: false, error: "Missing Server Members Intent or permission" };
        }
        return { success: false, error: `Discord API error: ${response.status}` };
      }

      const members = await response.json();
      if (members.length === 0) break;

      allMembers.push(...members);
      lastMemberId = members[members.length - 1].user.id;

      // If we got fewer than 1000, we've reached the end
      if (members.length < 1000) break;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Clear existing members for this guild and insert new ones
    await db.prepare("DELETE FROM guild_members_cache WHERE guild_id = ?").bind(guildId).run();

    // Count bots and humans
    let botCount = 0;
    let humanCount = 0;

    // Insert all members in batches to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < allMembers.length; i += batchSize) {
      const batch = allMembers.slice(i, i + batchSize);
      
      for (const member of batch) {
        const isBot = member.user.bot ? 1 : 0;
        if (isBot) botCount++;
        else humanCount++;
        
        await db.prepare(`
          INSERT INTO guild_members_cache 
            (guild_id, user_id, username, discriminator, global_name, nickname, 
             avatar, banner, accent_color, guild_avatar, guild_banner,
             is_bot, is_system, is_owner, flags, premium_type,
             joined_at, premium_since, pending, communication_disabled_until, 
             deaf, mute, roles, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          guildId,
          member.user.id,
          member.user.username,
          member.user.discriminator || '0',
          member.user.global_name || null,
          member.nick || null,
          member.user.avatar || null,
          member.user.banner || null,
          member.user.accent_color ?? null,
          member.avatar || null,
          member.banner || null,
          isBot,
          member.user.system ? 1 : 0,
          member.user.id === ownerId ? 1 : 0,
          member.user.public_flags || 0,
          member.user.premium_type || 0,
          member.joined_at || null,
          member.premium_since || null,
          member.pending ? 1 : 0,
          member.communication_disabled_until || null,
          member.deaf ? 1 : 0,
          member.mute ? 1 : 0,
          JSON.stringify(member.roles || [])
        ).run();
      }
    }

    log.debug(`[MembersCache] Cached ${allMembers.length} members (${humanCount} humans, ${botCount} bots) for guild ${guildId}`);
    return { success: true, count: allMembers.length, botCount, humanCount };
  } catch (error) {
    log.error(`[MembersCache] Error refreshing members for ${guildId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Update cache metadata after a refresh
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} data
 */
export async function updateCacheMetadata(db, guildId, data) {
  if (!db) return;

  try {
    await db.prepare(`
      INSERT INTO guild_cache_metadata 
        (guild_id, members_count, roles_count, bots_count, humans_count,
         members_last_refreshed, roles_last_refreshed, 
         last_refresh_duration_ms, last_refresh_status, last_refresh_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(guild_id) DO UPDATE SET
        members_count = COALESCE(excluded.members_count, members_count),
        roles_count = COALESCE(excluded.roles_count, roles_count),
        bots_count = COALESCE(excluded.bots_count, bots_count),
        humans_count = COALESCE(excluded.humans_count, humans_count),
        members_last_refreshed = COALESCE(excluded.members_last_refreshed, members_last_refreshed),
        roles_last_refreshed = COALESCE(excluded.roles_last_refreshed, roles_last_refreshed),
        last_refresh_duration_ms = excluded.last_refresh_duration_ms,
        last_refresh_status = excluded.last_refresh_status,
        last_refresh_error = excluded.last_refresh_error,
        updated_at = datetime('now')
    `).bind(
      guildId,
      data.membersCount ?? null,
      data.rolesCount ?? null,
      data.botsCount ?? null,
      data.humansCount ?? null,
      data.membersRefreshed ? new Date().toISOString() : null,
      data.rolesRefreshed ? new Date().toISOString() : null,
      data.durationMs ?? null,
      data.status ?? null,
      data.error ?? null
    ).run();
  } catch (error) {
    log.error(`[CacheMetadata] Error updating metadata for ${guildId}:`, error);
  }
}

/**
 * Get members with a specific role from cache
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} roleNameOrId - Role name (partial match) or exact role ID
 * @param {number} [limit=100]
 * @returns {Promise<{role: CachedRole|null, members: CachedMember[], error?: string}>}
 */
export async function getMembersWithRoleFromCache(db, guildId, roleNameOrId, limit = 100) {
  if (!db) {
    return { role: null, members: [], error: "Database not available" };
  }

  try {
    // First, find the role
    let role = await db.prepare(
      "SELECT * FROM guild_roles_cache WHERE guild_id = ? AND role_id = ?"
    ).bind(guildId, roleNameOrId).first();

    // If not found by ID, search by name
    if (!role) {
      const searchName = `%${roleNameOrId}%`;
      role = await db.prepare(
        "SELECT * FROM guild_roles_cache WHERE guild_id = ? AND name LIKE ? COLLATE NOCASE ORDER BY position DESC LIMIT 1"
      ).bind(guildId, searchName).first();
    }

    if (!role) {
      // Return available roles for error message
      const roles = await db.prepare(
        "SELECT role_id, name FROM guild_roles_cache WHERE guild_id = ? ORDER BY position DESC"
      ).bind(guildId).all();
      
      return { 
        role: null, 
        members: [], 
        error: `Role "${roleNameOrId}" not found`,
        availableRoles: roles.results || []
      };
    }

    // Find members with this role
    // The roles column is a JSON array, so we search for the role_id within it
    const members = await db.prepare(`
      SELECT * FROM guild_members_cache 
      WHERE guild_id = ? AND roles LIKE ?
      ORDER BY COALESCE(nickname, global_name, username) COLLATE NOCASE
      LIMIT ?
    `).bind(guildId, `%"${role.role_id}"%`, limit).all();

    const formattedMembers = (members.results || []).map(m => ({
      user_id: m.user_id,
      username: m.username,
      displayName: m.nickname || m.global_name || m.username,
      global_name: m.global_name,
      nickname: m.nickname,
      avatar: m.avatar,
      is_bot: Boolean(m.is_bot),
      joined_at: m.joined_at,
      roles: JSON.parse(m.roles || "[]"),
    }));

    return {
      role: {
        role_id: role.role_id,
        name: role.name,
        color: role.color,
        position: role.position,
        mentionable: Boolean(role.mentionable),
      },
      members: formattedMembers,
      memberCount: formattedMembers.length,
    };
  } catch (error) {
    log.error(`[MembersCache] Error getting members with role:`, error);
    return { role: null, members: [], error: error.message };
  }
}

/**
 * Get all roles for a guild from cache
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<CachedRole[]>}
 */
export async function getRolesFromCache(db, guildId) {
  if (!db) return [];

  try {
    const result = await db.prepare(
      "SELECT * FROM guild_roles_cache WHERE guild_id = ? ORDER BY position DESC"
    ).bind(guildId).all();

    return (result.results || []).map(r => ({
      role_id: r.role_id,
      name: r.name,
      color: r.color,
      position: r.position,
      permissions: r.permissions,
      hoist: Boolean(r.hoist),
      managed: Boolean(r.managed),
      mentionable: Boolean(r.mentionable),
      icon: r.icon,
      unicode_emoji: r.unicode_emoji,
    }));
  } catch (error) {
    log.error(`[RolesCache] Error getting roles:`, error);
    return [];
  }
}

/**
 * Get a member from cache
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<CachedMember|null>}
 */
export async function getMemberFromCache(db, guildId, userId) {
  if (!db) return null;

  try {
    const member = await db.prepare(
      "SELECT * FROM guild_members_cache WHERE guild_id = ? AND user_id = ?"
    ).bind(guildId, userId).first();

    if (!member) return null;

    return {
      user_id: member.user_id,
      username: member.username,
      displayName: member.nickname || member.global_name || member.username,
      global_name: member.global_name,
      nickname: member.nickname,
      avatar: member.avatar,
      guild_avatar: member.guild_avatar,
      is_bot: Boolean(member.is_bot),
      is_owner: Boolean(member.is_owner),
      joined_at: member.joined_at,
      premium_since: member.premium_since,
      roles: JSON.parse(member.roles || "[]"),
    };
  } catch (error) {
    log.error(`[MembersCache] Error getting member:`, error);
    return null;
  }
}

/**
 * Search members by name in cache
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} query - Search query
 * @param {number} [limit=20]
 * @returns {Promise<CachedMember[]>}
 */
export async function searchMembersInCache(db, guildId, query, limit = 20) {
  if (!db) return [];

  try {
    const searchPattern = `%${query}%`;
    const result = await db.prepare(`
      SELECT * FROM guild_members_cache 
      WHERE guild_id = ? AND (
        username LIKE ? COLLATE NOCASE OR
        global_name LIKE ? COLLATE NOCASE OR
        nickname LIKE ? COLLATE NOCASE
      )
      ORDER BY COALESCE(nickname, global_name, username) COLLATE NOCASE
      LIMIT ?
    `).bind(guildId, searchPattern, searchPattern, searchPattern, limit).all();

    return (result.results || []).map(m => ({
      user_id: m.user_id,
      username: m.username,
      displayName: m.nickname || m.global_name || m.username,
      global_name: m.global_name,
      nickname: m.nickname,
      is_bot: Boolean(m.is_bot),
      joined_at: m.joined_at,
      roles: JSON.parse(m.roles || "[]"),
    }));
  } catch (error) {
    log.error(`[MembersCache] Error searching members:`, error);
    return [];
  }
}

/**
 * Get cache metadata for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<Object|null>}
 */
export async function getCacheMetadata(db, guildId) {
  if (!db) return null;

  try {
    return await db.prepare(
      "SELECT * FROM guild_cache_metadata WHERE guild_id = ?"
    ).bind(guildId).first();
  } catch (error) {
    return null;
  }
}

/**
 * Check if cache needs refresh (older than specified minutes)
 * @param {D1Database} db
 * @param {string} guildId
 * @param {number} [maxAgeMinutes=60]
 * @returns {Promise<boolean>}
 */
export async function cacheNeedsRefresh(db, guildId, maxAgeMinutes = 60) {
  const metadata = await getCacheMetadata(db, guildId);
  if (!metadata || !metadata.members_last_refreshed) return true;

  const lastRefresh = new Date(metadata.members_last_refreshed);
  const ageMs = Date.now() - lastRefresh.getTime();
  return ageMs > maxAgeMinutes * 60 * 1000;
}
/**
 * Refresh all cache data for a guild (members and roles)
 * Used by cron job for comprehensive cache updates
 * @param {D1Database} db - D1 database
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Guild ID
 * @returns {Promise<{success: boolean, members?: Object, roles?: Object, error?: string}>}
 */
export async function refreshGuildCache(db, botToken, guildId) {
  if (!db || !botToken || !guildId) {
    return { success: false, error: "Missing required parameters" };
  }

  const startTime = Date.now();
  const results = {
    success: true,
    members: null,
    roles: null,
    error: null,
  };

  try {
    // First, get guild info to know the owner
    let ownerId = null;
    try {
      const guildResponse = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}`,
        { headers: { Authorization: `Bot ${botToken}` } }
      );
      if (guildResponse.ok) {
        const guild = await guildResponse.json();
        ownerId = guild.owner_id;
      }
    } catch (e) {
      log.debug(`[GuildCache] Could not fetch guild info for owner: ${e.message}`);
    }

    // Refresh roles first (faster, good baseline)
    const rolesResult = await refreshRolesCache(db, botToken, guildId);
    results.roles = rolesResult;
    
    if (!rolesResult.success) {
      log.warn(`[GuildCache] Roles refresh failed for ${guildId}: ${rolesResult.error}`);
    }

    // Small delay between API calls
    await new Promise(resolve => setTimeout(resolve, 100));

    // Refresh members (can be slow for large guilds)
    const membersResult = await refreshMembersCache(db, botToken, guildId, ownerId);
    results.members = membersResult;
    
    if (!membersResult.success) {
      log.warn(`[GuildCache] Members refresh failed for ${guildId}: ${membersResult.error}`);
      results.success = false;
      results.error = membersResult.error;
    }

    const durationMs = Date.now() - startTime;

    // Update metadata
    await updateCacheMetadata(db, guildId, {
      membersCount: membersResult.count ?? null,
      rolesCount: rolesResult.count ?? null,
      botsCount: membersResult.botCount ?? null,
      humansCount: membersResult.humanCount ?? null,
      membersRefreshed: membersResult.success,
      rolesRefreshed: rolesResult.success,
      durationMs,
      status: results.success ? 'success' : (rolesResult.success || membersResult.success ? 'partial' : 'failed'),
      error: results.error,
    });

    log.info(`[GuildCache] Refreshed cache for ${guildId} in ${durationMs}ms: ${membersResult.count ?? 0} members, ${rolesResult.count ?? 0} roles`);
    
    return results;
  } catch (error) {
    log.error(`[GuildCache] Error refreshing cache for ${guildId}:`, error);
    
    // Update metadata with failure
    await updateCacheMetadata(db, guildId, {
      durationMs: Date.now() - startTime,
      status: 'failed',
      error: error.message,
    });
    
    return { success: false, error: error.message };
  }
}