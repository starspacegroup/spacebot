import { fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  AUTOMATION_USER_SOURCES,
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
    userSources: AUTOMATION_USER_SOURCES,
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
    
    // Support both single trigger_event (legacy) and multiple trigger_events
    const triggerEvents = formData.getAll("trigger_events[]");
    const triggerEvent = formData.get("trigger_event");
    const allTriggers = triggerEvents.length > 0 
      ? triggerEvents.filter(Boolean)
      : (triggerEvent ? [triggerEvent] : []);

    // Parse stacked actions
    const actionTypes = formData.getAll("action_type[]");
    const actions = [];

    // Build actions array from form data
    actionTypes.forEach((type, index) => {
      if (!type) return;

      const config = {};
      for (const [key, value] of formData.entries()) {
        const prefix = `action_config.${index}.`;
        if (key.startsWith(prefix)) {
          const configKey = key.slice(prefix.length);
          config[configKey] = value;
        }
      }

      actions.push({ type, config });
    });

    // Parse trigger filters
    const triggerFilters = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("filter.") && value) {
        const filterKey = key.replace("filter.", "");
        triggerFilters[filterKey] = value;
      }
    }

    if (!name || allTriggers.length === 0 || actions.length === 0) {
      return fail(400, {
        error: "Name, at least one trigger event, and at least one action are required",
        values: { name, description, triggerEvents: allTriggers, actions },
      });
    }

    // For backwards compatibility, use the first action's type as the legacy action_type
    const primaryAction = actions[0];

    try {
      const result = await createAutomation(db, {
        guild_id: guildId,
        name,
        description: description || null,
        enabled: true,
        trigger_events: allTriggers,
        trigger_filters: Object.keys(triggerFilters).length > 0
          ? triggerFilters
          : null,
        action_type: primaryAction.type,
        action_config: { ...primaryAction.config, actions },
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
