import { fail, redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import {
  getGuildSettings,
  saveGuildSettings,
  DEFAULT_SETTINGS,
  normalizeLocalRunnerAssistPolicy,
} from "$lib/db/settings.js";
import { getGuildWebhooks, createWebhook, updateWebhook, deleteWebhook } from "$lib/db/webhooks.js";
import { hasFullAdminPermission, verifyGuildAdmin } from "$lib/discord/guilds.js";

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId: string | undefined, platform: any) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/**
 * Verify the user may mutate this guild's settings from a form action.
 * Actions have no parent() data, so this mirrors load()'s "superadmin OR
 * full administrator" gate using the shared guild helpers. In dev-auth-bypass
 * mode verifyGuildAdmin short-circuits to authorized. Returns a fail()
 * response to short-circuit on denial, or null when authorized.
 */
async function verifyActionAdmin(
  userId: string,
  serverId: string,
  platform: any,
  cookies: any,
) {
  if (checkIsSuperAdmin(userId, platform)) return null;

  const accessToken = cookies.get("discord_access_token");
  const verification = await verifyGuildAdmin(serverId, accessToken, cookies);
  if (!verification?.authorized || !hasFullAdminPermission(verification.guild)) {
    return fail(403, {
      success: false,
      message: "You do not have permission to manage this server.",
    });
  }
  return null;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  // Get parent layout data (includes adminGuilds, selectedGuildId, user, etc.)
  const parentData = await parent();

  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    throw redirect(302, "/login");
  }

  // Get the server ID from the route params
  const serverId = params.serverId;

  // Check if current user is a superadmin (has access to everything)
  const isSuperAdmin = checkIsSuperAdmin(userId, platform);

  // Use adminGuilds from parent layout
  const adminGuilds = parentData.adminGuilds || [];

  // Check if user has access to this specific server
  const hasAccessToServer = isSuperAdmin ||
    adminGuilds.some((g) => g.id === serverId);

  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  // Get guild info
  const guild = adminGuilds.find((g) => g.id === serverId);

  // Check if user has full administrator permission (not just MANAGE_GUILD)
  const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);

  // Only administrators can access settings
  if (!hasFullAdminAccess) {
    throw redirect(302, `/admin/${serverId}`);
  }

  // Load server settings from database
  const db = (platform as any)?.env?.DB;
  const dbSettings = db ? await getGuildSettings(db, serverId) : DEFAULT_SETTINGS;

  // Map database settings to UI format
  const settings = {
    prefix: dbSettings.prefix || "!",
    loggingChannelId: dbSettings.log_channel_id || null,
    loggingChannelName: null, // Would need to fetch from Discord API
    moderationRoleId: dbSettings.moderation_role_id || null,
    timezone: dbSettings.timezone || null,
    logEmbedColors: dbSettings.log_embed_colors || {},
    excludedCategories: dbSettings.excluded_categories || [],
  };

  // Permission settings - load from database or use defaults
  const dbPermSettings = dbSettings.permission_settings || {};
  const permissionSettings = {
    viewDashboard: {
      permission: dbPermSettings.viewDashboard?.permission || "MANAGE_GUILD",
      roles: dbPermSettings.viewDashboard?.roles || [],
    },
    viewLogs: {
      permission: dbPermSettings.viewLogs?.permission || "MANAGE_GUILD",
      roles: dbPermSettings.viewLogs?.roles || [],
    },
    manageAutomations: {
      permission: dbPermSettings.manageAutomations?.permission || "MANAGE_GUILD",
      roles: dbPermSettings.manageAutomations?.roles || [],
    },
    manageCommands: {
      permission: dbPermSettings.manageCommands?.permission || "MANAGE_GUILD",
      roles: dbPermSettings.manageCommands?.roles || [],
    },
    // Access server settings (this page) - always requires ADMINISTRATOR
    manageSettings: {
      permission: "ADMINISTRATOR",
      roles: [], // Cannot be overridden - always requires admin
    },
    localRunnerAssist: normalizeLocalRunnerAssistPolicy(dbPermSettings.localRunnerAssist),
  };

  // Load webhooks for this guild
  const webhooks = db ? await getGuildWebhooks(db, serverId) : [];

  // Available Discord permissions for the dropdown
  const discordPermissions = [
    { value: "ADMINISTRATOR", label: "Administrator", description: "Full server control" },
    { value: "MANAGE_GUILD", label: "Manage Server", description: "Can change server settings" },
    { value: "MANAGE_CHANNELS", label: "Manage Channels", description: "Can create/edit channels" },
    { value: "MANAGE_ROLES", label: "Manage Roles", description: "Can create/edit roles" },
    { value: "MANAGE_MESSAGES", label: "Manage Messages", description: "Can delete messages" },
    { value: "KICK_MEMBERS", label: "Kick Members", description: "Can kick members" },
    { value: "BAN_MEMBERS", label: "Ban Members", description: "Can ban members" },
    { value: "MODERATE_MEMBERS", label: "Moderate Members", description: "Can timeout members" },
  ];

  // Available HTTP methods for webhooks
  const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  return {
    serverId,
    guild,
    settings,
    permissionSettings,
    discordPermissions,
    hasFullAdminAccess,
    webhooks,
    httpMethods,
  };
}

/** @type {import('./$types').Actions} */
export const actions = {
  /**
   * Update server settings
   */
  updateSettings: async ({ request, cookies, platform, params }) => {
    const userId = cookies.get("discord_user_id");
    const serverId = params.serverId;

    if (!userId) {
      return fail(401, { success: false, message: "Not authenticated" });
    }

    const denied = await verifyActionAdmin(userId, serverId, platform, cookies);
    if (denied) return denied;

    const formData = await request.formData();
    const loggingChannelId = formData.get("loggingChannelId");
    const timezone = formData.get("timezone") || null;

    // Excluded log categories (JSON string from hidden input)
    let excludedCategories = [];
    const excludedCategoriesRaw = formData.get("excludedCategories");
    if (excludedCategoriesRaw) {
      try {
        const parsed = JSON.parse(excludedCategoriesRaw as string);
        if (Array.isArray(parsed)) {
          excludedCategories = parsed.filter(c => typeof c === 'string');
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Log embed colors (JSON string from hidden input)
    let logEmbedColors = {};
    const logEmbedColorsRaw = formData.get("logEmbedColors");
    if (logEmbedColorsRaw) {
      try {
        const parsed = JSON.parse(logEmbedColorsRaw as string);
        // Validate: only allow hex color values per category
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
            logEmbedColors[key] = value;
          }
        }
      } catch {
        // Invalid JSON, ignore and use empty
      }
    }

    // Permission settings
    const viewDashboardPerm = formData.get("viewDashboardPerm") || "MANAGE_GUILD";
    const viewLogsPerm = formData.get("viewLogsPerm") || "MANAGE_GUILD";
    const manageAutomationsPerm = formData.get("manageAutomationsPerm") || "MANAGE_GUILD";
    const manageCommandsPerm = formData.get("manageCommandsPerm") || "MANAGE_GUILD";
    const localRunnerEnabled = formData.get("localRunnerEnabled") === "on";
    const localRunnerAllowedUsersRaw = String(formData.get("localRunnerAllowedUsers") || "");
    const localRunnerAllowedUsers = [...new Set(
      localRunnerAllowedUsersRaw
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter((id) => /^\d{17,20}$/.test(id))
    )];

    log.info(`[Settings] Updating settings for server ${serverId}:`, {
      loggingChannelId,
      viewDashboardPerm,
      viewLogsPerm,
      manageAutomationsPerm,
      manageCommandsPerm,
      localRunnerEnabled,
      localRunnerAllowedUsersCount: localRunnerAllowedUsers.length,
    });

    // Save settings to database
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { success: false, message: "Database not available" });
    }

    try {
      await saveGuildSettings(db, serverId, {
        logging_enabled: !!loggingChannelId, // Enable logging if a channel is set
        log_channel_id: loggingChannelId || null,
        log_embed_colors: logEmbedColors,
        excluded_categories: excludedCategories,
        timezone: timezone,
        permission_settings: {
          viewDashboard: { permission: viewDashboardPerm, roles: [] },
          viewLogs: { permission: viewLogsPerm, roles: [] },
          manageAutomations: { permission: manageAutomationsPerm, roles: [] },
          manageCommands: { permission: manageCommandsPerm, roles: [] },
          manageSettings: { permission: "ADMINISTRATOR", roles: [] },
          localRunnerAssist: {
            enabled: localRunnerEnabled,
            allowedUserIds: localRunnerAllowedUsers,
          },
        },
      });

      return {
        success: true,
        message: "Settings updated successfully!",
      };
    } catch (error) {
      log.error(`[Settings] Failed to save settings for server ${serverId}:`, error);
      return fail(500, { success: false, message: "Failed to save settings" });
    }
  },

  /**
   * Create a new webhook
   */
  createWebhook: async ({ request, cookies, platform, params }) => {
    const userId = cookies.get("discord_user_id");
    const serverId = params.serverId;

    if (!userId) {
      return fail(401, { success: false, message: "Not authenticated" });
    }

    const denied = await verifyActionAdmin(userId, serverId, platform, cookies);
    if (denied) return denied;

    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { success: false, message: "Database not available" });
    }

    const formData = await request.formData();
    const name = formData.get("webhookName");
    const description = formData.get("webhookDescription");
    const url = formData.get("webhookUrl");
    const method = formData.get("webhookMethod") || "POST";

    // Parse custom headers (key:value pairs, one per line)
    const headersRaw = (formData.get("webhookHeaders") || "") as string;
    const headers = {};
    if (headersRaw.trim()) {
      for (const line of headersRaw.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          if (key) headers[key] = value;
        }
      }
    }

    log.info(`[Settings] Creating webhook for server ${serverId}:`, { name, method });

    const result = await createWebhook(db, serverId, {
      name,
      description,
      url,
      method,
      headers,
      enabled: true,
    }, userId);

    if (!result.success) {
      return fail(400, { success: false, message: result.error });
    }

    return {
      success: true,
      message: "Webhook created successfully!",
    };
  },

  /**
   * Update an existing webhook
   */
  updateWebhook: async ({ request, cookies, platform, params }) => {
    const userId = cookies.get("discord_user_id");
    const serverId = params.serverId;

    if (!userId) {
      return fail(401, { success: false, message: "Not authenticated" });
    }

    const denied = await verifyActionAdmin(userId, serverId, platform, cookies);
    if (denied) return denied;

    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { success: false, message: "Database not available" });
    }

    const formData = await request.formData();
    const webhookId = formData.get("webhookId");
    const name = formData.get("webhookName");
    const description = formData.get("webhookDescription");
    const url = formData.get("webhookUrl");
    const method = formData.get("webhookMethod") || "POST";
    const enabled = formData.get("webhookEnabled") === "on";

    // Parse custom headers
    const headersRaw = (formData.get("webhookHeaders") || "") as string;
    const headers = {};
    if (headersRaw.trim()) {
      for (const line of headersRaw.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          if (key) headers[key] = value;
        }
      }
    }

    log.info(`[Settings] Updating webhook ${webhookId} for server ${serverId}`);

    const result = await updateWebhook(db, parseInt(webhookId as string), serverId, {
      name,
      description,
      url,
      method,
      headers,
      enabled,
    });

    if (!result.success) {
      return fail(400, { success: false, message: result.error });
    }

    return {
      success: true,
      message: "Webhook updated successfully!",
    };
  },

  /**
   * Delete a webhook
   */
  deleteWebhook: async ({ request, cookies, platform, params }) => {
    const userId = cookies.get("discord_user_id");
    const serverId = params.serverId;

    if (!userId) {
      return fail(401, { success: false, message: "Not authenticated" });
    }

    const denied = await verifyActionAdmin(userId, serverId, platform, cookies);
    if (denied) return denied;

    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { success: false, message: "Database not available" });
    }

    const formData = await request.formData();
    const webhookId = formData.get("webhookId");

    log.info(`[Settings] Deleting webhook ${webhookId} for server ${serverId}`);

    const result = await deleteWebhook(db, parseInt(webhookId as string), serverId);

    if (!result.success) {
      return fail(400, { success: false, message: result.error });
    }

    return {
      success: true,
      message: "Webhook deleted successfully!",
    };
  },
};
