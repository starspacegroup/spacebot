import { fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  createAutomation,
  FILTER_TYPES,
  TEMPLATE_VARIABLES,
} from "$lib/db/automations.js";
import { EVENT_CATEGORIES, EVENT_TYPES } from "$lib/db/logger.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent }) {
  const parentData = await parent();

  // Require admin access
  if (!parentData.selectedGuildId) {
    throw redirect(302, "/admin");
  }

  return {
    // Meta info for the UI
    actionTypes: ACTION_TYPES,
    filterTypes: FILTER_TYPES,
    eventTypes: EVENT_TYPES,
    eventCategories: EVENT_CATEGORIES,
    templateVariables: TEMPLATE_VARIABLES,
  };
}

/** @type {import('./$types').Actions} */
export const actions = {
  default: async ({ request, cookies, platform, params }) => {
    const db = platform?.env?.DB;
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
        values: { name, description, triggerEvent, actionType, actionConfig },
      });
    }

    try {
      const result = await createAutomation(db, {
        guild_id: guildId,
        name,
        description: description || null,
        enabled: true,
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

      // Redirect back to automations list on success
      throw redirect(302, `/admin/${params.serverId}/automations?created=true`);
    } catch (error) {
      // Re-throw redirects
      if (error.status === 302) throw error;

      console.error("Create automation error:", error);
      return fail(500, { error: "Failed to create automation" });
    }
  },
};
