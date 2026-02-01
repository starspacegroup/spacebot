import { fail, redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getGuildSettings, saveGuildSettings, DEFAULT_SETTINGS } from "$lib/db/settings.js";
import { hasFullAdminPermission } from "$lib/discord/guilds.js";

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
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
  const db = platform?.env?.DB;
  const dbSettings = db ? await getGuildSettings(db, serverId) : DEFAULT_SETTINGS;

  // Map database settings to UI format
  const settings = {
    prefix: dbSettings.prefix || "!",
    loggingChannelId: dbSettings.log_channel_id || null,
    loggingChannelName: null, // Would need to fetch from Discord API
    moderationRoleId: dbSettings.moderation_role_id || null,
    welcomeEnabled: dbSettings.welcome_enabled || false,
    welcomeChannelId: dbSettings.welcome_channel_id || null,
    welcomeChannelName: null, // Would need to fetch from Discord API
    welcomeMessage: dbSettings.welcome_message || "Welcome {user} to {server}!",
  };

  // Permission settings - who can access what in the web interface
  // These map Discord permissions to web interface features
  const permissionSettings = {
    // View-only access to the dashboard
    viewDashboard: {
      permission: "MANAGE_GUILD", // Discord permission required
      roles: [], // Or specific role IDs that override
    },
    // View event logs
    viewLogs: {
      permission: "MANAGE_GUILD",
      roles: [],
    },
    // Manage automations (create, edit, delete)
    manageAutomations: {
      permission: "MANAGE_GUILD",
      roles: [],
    },
    // Manage custom commands
    manageCommands: {
      permission: "MANAGE_GUILD",
      roles: [],
    },
    // Access server settings (this page) - always requires ADMINISTRATOR
    manageSettings: {
      permission: "ADMINISTRATOR",
      roles: [], // Cannot be overridden - always requires admin
    },
  };

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

  return {
    serverId,
    guild,
    settings,
    permissionSettings,
    discordPermissions,
    hasFullAdminAccess,
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

    // TODO: Verify user has admin access to this server
    // TODO: Save settings to database

    const formData = await request.formData();
    const prefix = formData.get("prefix");
    const loggingChannelId = formData.get("loggingChannelId");
    const moderationRoleId = formData.get("moderationRoleId");
    const welcomeEnabled = formData.get("welcomeEnabled") === "on";
    const welcomeChannelId = formData.get("welcomeChannelId");
    const welcomeMessage = formData.get("welcomeMessage");

    log.info(`[Settings] Updating settings for server ${serverId}:`, {
      prefix,
      loggingChannelId,
      moderationRoleId,
      welcomeEnabled,
      welcomeChannelId,
    });

    // Save settings to database
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { success: false, message: "Database not available" });
    }

    try {
      await saveGuildSettings(db, serverId, {
        prefix: prefix || "!",
        log_channel_id: loggingChannelId || null,
        moderation_role_id: moderationRoleId || null,
        welcome_enabled: welcomeEnabled,
        welcome_channel_id: welcomeChannelId || null,
        welcome_message: welcomeMessage || "Welcome {user} to {server}!",
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
};
