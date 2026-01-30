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
        if (event.channel_id !== filterValue) return false;
        break;

      case "not_channel_id":
        if (event.channel_id === filterValue) return false;
        break;

      case "actor_has_role":
        if (!context.actorRoles?.includes(filterValue)) return false;
        break;

      case "actor_missing_role":
        if (context.actorRoles?.includes(filterValue)) return false;
        break;

      case "target_has_role":
        if (!context.targetRoles?.includes(filterValue)) return false;
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

    console.log(
      `[Automation Process] Received event: ${event?.event_type} for guild ${guildId}`,
    );

    if (!event || !event.event_type) {
      return json({ error: "Invalid event data" }, { status: 400 });
    }

    // Ignore events from bots by default to prevent infinite loops
    // (e.g., bot sends message -> triggers automation -> sends another message)
    if (event.details?.isBot === true) {
      console.log(
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

    console.log(
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
        console.log(
          `[Automation Process] Automation "${automation.name}" filter match: ${matches}`,
        );
        if (!matches && automation.trigger_filters) {
          console.log(
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

        processed.context = context;
        return processed;
      });

    console.log(
      `[Automation Process] Returning ${matchingAutomations.length} matching automations`,
    );
    return json({ automations: matchingAutomations });
  } catch (error) {
    console.error("Automation processing error:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}
