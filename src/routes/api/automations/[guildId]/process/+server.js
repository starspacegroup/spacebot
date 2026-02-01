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
import { matchesFilters, processTemplate, buildContext } from "$lib/automation/engine.js";

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

    // Log event details for debugging
    log.debug(
      `[Automation Process] Event details: target_id=${event.target_id}, commandName=${event.details?.commandName}, embedTexts=${JSON.stringify(event.details?.embedTexts?.slice(0, 2))}`,
    );

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

    // Log each automation's filters for debugging
    for (const auto of automations) {
      log.debug(
        `[Automation Process] Automation "${auto.name}" filters: ${JSON.stringify(auto.trigger_filters)}`,
      );
    }

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
            `[Automation Process] Filters: ${JSON.stringify(automation.trigger_filters)}`,
          );
          log.debug(
            `[Automation Process] Event target_id: ${event.target_id}, commandName: ${event.details?.commandName}`,
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
