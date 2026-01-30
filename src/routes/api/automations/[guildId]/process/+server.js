/**
 * Automation processing API endpoint
 * Called by the gateway bot to get automations to execute
 * POST - Process an event and return matching automations
 */

import { json } from "@sveltejs/kit";
import {
  getTriggeredAutomations,
  logAutomationExecution,
} from "$lib/db/automations.js";
import { log } from "$lib/db/logger.js";

/**
 * Process template variables in a string
 */
function processTemplate(template, context) {
  if (!template) return template;

  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const parts = path.split(".");
    let value = context;

    for (const part of parts) {
      if (value === undefined || value === null) return match;
      value = value[part];
    }

    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Check if an event matches the automation's filters
 */
function matchesFilters(event, filters, context = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }

  for (const [filterType, filterValue] of Object.entries(filters)) {
    switch (filterType) {
      case "channel_id":
        // "ALL" means match any channel, comma-separated list for multiple channels
        if (filterValue !== "ALL") {
          const allowedChannels = filterValue.split(",").map((id) => id.trim());
          if (!allowedChannels.includes(event.channel_id)) return false;
        }
        break;

      case "not_channel_id":
        // "ALL" for not_channel_id doesn't make sense, skip if set to ALL
        if (filterValue !== "ALL") {
          const blockedChannels = filterValue.split(",").map((id) => id.trim());
          if (blockedChannels.includes(event.channel_id)) return false;
        }
        break;

      case "actor_has_role":
        // "ALL" means match any role (no filter)
        if (filterValue !== "ALL") {
          const requiredRoles = filterValue.split(",").map((id) => id.trim());
          if (!requiredRoles.some((role) => context.actorRoles?.includes(role))) return false;
        }
        break;

      case "actor_missing_role":
        // "ALL" for actor_missing_role doesn't make sense, skip if set to ALL
        if (filterValue !== "ALL") {
          const blockedRoles = filterValue.split(",").map((id) => id.trim());
          if (blockedRoles.some((role) => context.actorRoles?.includes(role))) return false;
        }
        break;

      case "target_has_role":
        // "ALL" means match any role (no filter)
        if (filterValue !== "ALL") {
          const requiredRoles = filterValue.split(",").map((id) => id.trim());
          if (!requiredRoles.some((role) => context.targetRoles?.includes(role))) return false;
        }
        break;

      case "content_contains":
        if (
          !event.details?.content?.toLowerCase().includes(
            filterValue.toLowerCase(),
          )
        ) return false;
        break;

      case "content_regex":
        try {
          const regex = new RegExp(filterValue, "i");
          if (!regex.test(event.details?.content || "")) return false;
        } catch {
          return false;
        }
        break;

      case "is_bot":
        if (event.details?.isBot !== filterValue) return false;
        break;

      case "is_not_bot":
        if (event.details?.isBot === true) return false;
        break;
    }
  }

  return true;
}

/**
 * Build variable context from event data
 */
function buildContext(event) {
  return {
    user: {
      id: event.actor_id,
      name: event.actor_name?.split("#")[0] || event.actor_name,
      tag: event.actor_name,
      mention: event.actor_id ? `<@${event.actor_id}>` : "",
    },
    target: {
      id: event.target_id,
      name: event.target_name?.split("#")[0] || event.target_name,
      tag: event.target_name,
      mention: event.target_id ? `<@${event.target_id}>` : "",
    },
    channel: {
      id: event.channel_id,
      name: event.channel_name,
      mention: event.channel_id ? `<#${event.channel_id}>` : "",
    },
    guild: {
      id: event.guild_id,
    },
    trigger: {
      event: event.event_type,
      category: event.event_category,
      time: new Date().toISOString(),
    },
    details: event.details || {},
  };
}

/**
 * Verify bot authorization
 */
function verifyBotAuth(request) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bot ")) {
    return false;
  }

  const token = auth.slice(4);
  const expectedToken = process.env.DISCORD_BOT_TOKEN;

  return token === expectedToken;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  // Verify this is coming from our bot
  if (!verifyBotAuth(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = params;
  const db = platform?.env?.DB;

  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const { event } = await request.json();

    log.debug(
      `[Automation Process] Received event: ${event?.event_type} for guild ${guildId}`,
    );

    if (!event || !event.event_type) {
      return json({ error: "Invalid event data" }, { status: 400 });
    }

    // Ignore events from bots by default to prevent infinite loops
    // (e.g., bot sends message -> triggers automation -> sends another message)
    if (event.details?.isBot === true) {
      log.debug(
        `[Automation Process] Ignoring bot event: ${event.event_type}`,
      );
      return json({ automations: [] });
    }

    // Get automations for this event type
    const automations = await getTriggeredAutomations(
      db,
      guildId,
      event.event_type,
    );

    log.debug(
      `[Automation Process] Found ${automations.length} automations for ${event.event_type}`,
    );

    if (automations.length === 0) {
      return json({ automations: [] });
    }

    // Build context for template processing
    const context = buildContext(event);

    // Filter automations that match and prepare them for execution
    const matchingAutomations = automations
      .filter((automation) => {
        const matches = matchesFilters(event, automation.trigger_filters);
        log.debug(
          `[Automation Process] Automation "${automation.name}" filter match: ${matches}`,
        );
        if (!matches && automation.trigger_filters) {
          log.debug(
            `[Automation Process] Filters: ${
              JSON.stringify(automation.trigger_filters)
            }`,
          );
        }
        return matches;
      })
      .map((automation) => {
        // Pre-process templates for the gateway
        const processed = { ...automation };

        // Handle single action templates (legacy format)
        if (automation.action_config.content) {
          processed.processed_content = processTemplate(
            automation.action_config.content,
            context,
          );
        }
        if (automation.action_config.reason) {
          processed.processed_reason = processTemplate(
            automation.action_config.reason,
            context,
          );
        }
        if (automation.action_config.thread_name) {
          processed.processed_thread_name = processTemplate(
            automation.action_config.thread_name,
            context,
          );
        }

        // Handle stacked actions - process templates for each action
        if (
          automation.action_config.actions &&
          Array.isArray(automation.action_config.actions)
        ) {
          processed.action_config = {
            ...automation.action_config,
            actions: automation.action_config.actions.map((action) => ({
              ...action,
              config: {
                ...action.config,
                // Process template variables in action config
                content: action.config?.content
                  ? processTemplate(action.config.content, context)
                  : undefined,
                reason: action.config?.reason
                  ? processTemplate(action.config.reason, context)
                  : undefined,
                thread_name: action.config?.thread_name
                  ? processTemplate(action.config.thread_name, context)
                  : undefined,
              },
            })),
          };
        }

        processed.context = context;
        return processed;
      });

    log.debug(
      `[Automation Process] Returning ${matchingAutomations.length} matching automations`,
    );
    
    // Debug: log the action config structure
    for (const auto of matchingAutomations) {
      log.debug(`[Automation Process] ${auto.name} action_type: ${auto.action_type}`);
      log.debug(`[Automation Process] ${auto.name} has actions array: ${!!auto.action_config?.actions}`);
      if (auto.action_config?.actions) {
        log.debug(`[Automation Process] ${auto.name} actions:`, JSON.stringify(auto.action_config.actions, null, 2));
      }
    }
    
    return json({ automations: matchingAutomations });
  } catch (error) {
    log.error("Automation processing error:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}
