import { error, fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  AUTOMATION_USER_SOURCES,
  deleteAutomation,
  FILTER_TYPES,
  getAutomation,
  TEMPLATE_VARIABLES,
  updateAutomation,
} from "$lib/db/automations.js";
import { getGuildWebhooks } from "$lib/db/webhooks.js";
import { EVENT_CATEGORIES, EVENT_TYPES, getGuildGitHubRepositories, log } from "$lib/db/logger.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
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

  const db = platform?.env?.DB;
  // automationId can be either numeric ID or public_id hash
  const automationId = params.automationId;

  if (!db) {
    throw error(500, "Database not available");
  }

  if (!automationId) {
    throw error(400, "Invalid automation ID");
  }

  try {
    const automation = await getAutomation(
      db,
      automationId,
      guildId,
    );

    if (!automation) {
      throw error(404, "Automation not found");
    }

    // Load webhooks for this guild
    const webhooks = await getGuildWebhooks(db, guildId);
    const githubRepositories = await getGuildGitHubRepositories(db, guildId);
    const enabledWebhooks = webhooks.filter(w => w.enabled).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      method: w.method,
    }));

    return {
      automation,
      // Meta info for the UI
      actionTypes: ACTION_TYPES,
      filterTypes: FILTER_TYPES,
      eventTypes: EVENT_TYPES,
      eventCategories: EVENT_CATEGORIES,
      templateVariables: TEMPLATE_VARIABLES,
      userSources: AUTOMATION_USER_SOURCES,
      webhooks: enabledWebhooks,
      githubRepositories,
    };
  } catch (err) {
    if (err.status) throw err;
    log.error("Failed to load automation:", err);
    throw error(500, "Failed to load automation");
  }
}

/** @type {import('./$types').Actions} */
export const actions = {
  update: async ({ request, platform, params }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = params.automationId;
    const guildId = formData.get("guild_id");

    if (!id || !guildId) {
      return fail(400, { error: "Automation ID and Guild ID are required" });
    }

    // Parse form data
    const updates = {};
    const name = formData.get("name");
    const description = formData.get("description");

    // Support both single trigger_event (legacy) and multiple trigger_events
    const triggerEvents = formData.getAll("trigger_events[]");
    const triggerEvent = formData.get("trigger_event");
    const allTriggers = triggerEvents.length > 0
      ? triggerEvents.filter(Boolean)
      : (triggerEvent ? [triggerEvent] : null);

    if (name) updates.name = name;
    if (description !== null) updates.description = description;
    if (allTriggers && allTriggers.length > 0) {
      updates.trigger_events = allTriggers;
    }

    // Parse stacked actions (new format: action_type[] and action_config.{index}.{key})
    const actionTypes = formData.getAll("action_type[]");
    const actions = [];

    for (let i = 0; i < actionTypes.length; i++) {
      if (actionTypes[i]) {
        const actionConfig = {};
        for (const [key, value] of formData.entries()) {
          const prefix = `action_config.${i}.`;
          if (key.startsWith(prefix)) {
            const configKey = key.replace(prefix, "");
            actionConfig[configKey] = value;
          }
        }
        actions.push({
          type: actionTypes[i],
          config: actionConfig,
        });
      }
    }

    // Store actions as the new format
    updates.actions = actions;
    // For backwards compatibility, also set legacy fields
    if (actions.length === 1) {
      updates.action_type = actions[0].type;
      updates.action_config = actions[0].config;
    } else if (actions.length === 0) {
      updates.action_type = "NONE";
      updates.action_config = {};
    } else {
      updates.action_type = "MULTIPLE";
      updates.action_config = {};
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

      // Redirect back to automations list on success
      throw redirect(302, `/admin/${params.serverId}/automations?updated=true`);
    } catch (error) {
      // Re-throw redirects
      if (error.status === 302) throw error;

      log.error("Update automation error:", error);
      return fail(500, { error: "Failed to update automation" });
    }
  },

  delete: async ({ request, platform, params }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    try {
      const result = await deleteAutomation(
        db,
        params.automationId,
        guildId,
      );

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Redirect back to automations list on success
      throw redirect(302, `/admin/${params.serverId}/automations?deleted=true`);
    } catch (error) {
      // Re-throw redirects
      if (error.status === 302) throw error;

      log.error("Delete automation error:", error);
      return fail(500, { error: "Failed to delete automation" });
    }
  },
};
