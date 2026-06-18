import { fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  createAutomation,
  deleteAutomation,
  FILTER_TYPES,
  getAutomation,
  getAutomationLogs,
  getAutomations,
  TEMPLATE_VARIABLES,
  toggleAutomation,
  updateAutomation,
} from "$lib/db/automations.js";
import { EVENT_CATEGORIES, EVENT_TYPES, log } from "$lib/db/logger.js";
import { checkPlanLimit } from "$lib/db/server-plans.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, url, params }) {
  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();
  const guildId = params.serverId;

  // Require admin access - check that user has access to this guild
  if (!parentData.adminGuilds?.some(g => g.id === guildId) && !parentData.isSuperAdmin) {
    throw redirect(302, "/admin");
  }

  const db = (platform as any)?.env?.DB;

  // Get query params for filtering
  const eventType = url.searchParams.get("eventType") || undefined;
  const enabled = url.searchParams.get("enabled");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  let automations = [];
  let total = 0;
  let recentLogs = [];

  log.info(`[Automations Page] Loading automations for guild: ${guildId}, db available: ${!!db}`);

  if (db) {
    try {
      const result = await getAutomations(db, guildId, {
        limit,
        offset,
        eventType,
        enabled: enabled !== null ? enabled === "true" : undefined,
      });
      automations = result.automations;
      total = result.total;
      log.info(`[Automations Page] Found ${total} total automations, returning ${automations.length}`);

      // Get recent automation logs
      const logsResult = await getAutomationLogs(db, guildId, { limit: 10 });
      recentLogs = logsResult.logs;
    } catch (error) {
      log.error("Failed to fetch automations:", error);
    }
  } else {
    log.warn("[Automations Page] Database not available!");
  }

  return {
    automations,
    total,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: offset + automations.length < total,
      hasPrev: page > 1,
    },
    recentLogs,
    // Meta info for the UI
    actionTypes: ACTION_TYPES,
    filterTypes: FILTER_TYPES,
    eventTypes: EVENT_TYPES,
    eventCategories: EVENT_CATEGORIES,
    templateVariables: TEMPLATE_VARIABLES,
    // Filter state
    filters: {
      eventType,
      enabled,
    },
  };
}

/** @type {import('./$types').Actions} */
export const actions = {
  create: async ({ request, cookies, platform, url }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");
    const userId = cookies.get("discord_user_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    // Parse form data
    const name = formData.get("name");
    const description = formData.get("description");
    const triggerEvent = formData.get("trigger_event");
    const actionType = formData.get("action_type");

    // Parse action config from form
    const actionConfig = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("action_config.")) {
        const configKey = key.replace("action_config.", "");
        actionConfig[configKey] = value;
      }
    }

    // Parse trigger filters
    const triggerFilters = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("filter.") && value) {
        const filterKey = key.replace("filter.", "");
        triggerFilters[filterKey] = value;
      }
    }

    if (!name || !triggerEvent || !actionType) {
      return fail(400, {
        error: "Name, trigger event, and action type are required",
        values: { name, description, triggerEvent, actionType },
      });
    }

    try {
      // Check plan limits — if over quota, create as disabled
      const activeResult = await getAutomations(db, guildId, { enabled: true, limit: 1000 });
      const activeCount = activeResult.automations?.length || 0;
      const planCheck = await checkPlanLimit(db, guildId, 'automations', activeCount);
      const enabledByDefault = planCheck.allowed;

      const result = await createAutomation(db, {
        guild_id: guildId,
        name,
        description: description || null,
        enabled: enabledByDefault,
        trigger_event: triggerEvent,
        trigger_filters: Object.keys(triggerFilters).length > 0
          ? triggerFilters
          : null,
        action_type: actionType,
        action_config: actionConfig,
        created_by: userId,
      });

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      return {
        success: true,
        message: enabledByDefault
          ? "Automation created successfully!"
          : "Automation created but disabled — you've reached your plan's active limit. Upgrade or disable another automation to enable it.",
        id: result.id,
        createdDisabled: !enabledByDefault,
      };
    } catch (error) {
      log.error("Create automation error:", error);
      return fail(500, { error: "Failed to create automation" });
    }
  },

  update: async ({ request, platform }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = formData.get("id");
    const guildId = formData.get("guild_id");

    if (!id || !guildId) {
      return fail(400, { error: "Automation ID and Guild ID are required" });
    }

    // Parse form data
    const updates: Record<string, any> = {};
    const name = formData.get("name");
    const description = formData.get("description");
    const triggerEvent = formData.get("trigger_event");
    const actionType = formData.get("action_type");

    if (name) updates.name = name;
    if (description !== null) updates.description = description;
    if (triggerEvent) updates.trigger_event = triggerEvent;
    if (actionType) updates.action_type = actionType;

    // Parse action config
    const actionConfig = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("action_config.")) {
        const configKey = key.replace("action_config.", "");
        actionConfig[configKey] = value;
      }
    }
    if (Object.keys(actionConfig).length > 0) {
      updates.action_config = actionConfig;
    }

    // Parse trigger filters
    const triggerFilters = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("filter.") && value) {
        const filterKey = key.replace("filter.", "");
        triggerFilters[filterKey] = value;
      }
    }
    updates.trigger_filters = Object.keys(triggerFilters).length > 0
      ? triggerFilters
      : null;

    try {
      const result = await updateAutomation(db, id, updates, guildId);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      return { success: true, message: "Automation updated successfully!" };
    } catch (error) {
      log.error("Update automation error:", error);
      return fail(500, { error: "Failed to update automation" });
    }
  },

  toggle: async ({ request, platform }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = formData.get("id");
    const guildId = formData.get("guild_id");
    const enabled = formData.get("enabled") === "true";

    if (!id || !guildId) {
      return fail(400, { error: "Automation ID and Guild ID are required" });
    }

    // If enabling, check plan limits
    if (enabled) {
      try {
        const activeResult = await getAutomations(db, guildId, { enabled: true, limit: 1000 });
        const activeCount = activeResult.automations?.length || 0;
        const planCheck = await checkPlanLimit(db, guildId, 'automations', activeCount);
        if (!planCheck.allowed) {
          return fail(403, {
            error: `Automation limit reached (${planCheck.current}/${planCheck.limit}). Upgrade your plan or disable another automation first.`,
          });
        }
      } catch (err) {
        log.warn("Plan limit check failed, allowing toggle:", err);
      }
    }

    try {
      const result = await toggleAutomation(db, id, guildId, enabled);

      if (!result.success) {
        return fail(500, { error: "Failed to toggle automation" });
      }

      return {
        success: true,
        message: enabled ? "Automation enabled" : "Automation disabled",
      };
    } catch (error) {
      log.error("Toggle automation error:", error);
      return fail(500, { error: "Failed to toggle automation" });
    }
  },

  delete: async ({ request, platform }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = formData.get("id");
    const guildId = formData.get("guild_id");

    if (!id || !guildId) {
      return fail(400, { error: "Automation ID and Guild ID are required" });
    }

    try {
      const result = await deleteAutomation(db, id, guildId);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      return { success: true, message: "Automation deleted successfully!" };
    } catch (error) {
      log.error("Delete automation error:", error);
      return fail(500, { error: "Failed to delete automation" });
    }
  },
};
