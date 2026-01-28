import { error, fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  deleteAutomation,
  FILTER_TYPES,
  getAutomation,
  TEMPLATE_VARIABLES,
  updateAutomation,
} from "$lib/db/automations.js";
import { EVENT_CATEGORIES, EVENT_TYPES } from "$lib/db/logger.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
  const parentData = await parent();

  // Require admin access
  if (!parentData.selectedGuildId) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;
  const automationId = parseInt(params.automationId);

  if (!db) {
    throw error(500, "Database not available");
  }

  if (isNaN(automationId)) {
    throw error(400, "Invalid automation ID");
  }

  try {
    const automation = await getAutomation(
      db,
      automationId,
      parentData.selectedGuildId,
    );

    if (!automation) {
      throw error(404, "Automation not found");
    }

    return {
      automation,
      // Meta info for the UI
      actionTypes: ACTION_TYPES,
      filterTypes: FILTER_TYPES,
      eventTypes: EVENT_TYPES,
      eventCategories: EVENT_CATEGORIES,
      templateVariables: TEMPLATE_VARIABLES,
    };
  } catch (err) {
    if (err.status) throw err;
    console.error("Failed to load automation:", err);
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
      const result = await updateAutomation(db, parseInt(id), updates);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Redirect back to automations list on success
      throw redirect(302, `/admin/${params.serverId}/automations?updated=true`);
    } catch (error) {
      // Re-throw redirects
      if (error.status === 302) throw error;

      console.error("Update automation error:", error);
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
        parseInt(params.automationId),
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

      console.error("Delete automation error:", error);
      return fail(500, { error: "Failed to delete automation" });
    }
  },
};
