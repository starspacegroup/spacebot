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
import { getMemberFromCache } from "$lib/db/guild-cache.js";
import { getLatestServerStats } from "$lib/db/server-stats.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";

/**
 * Verify bot authorization
 */
function verifyBotAuth(request, platform) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bot ")) {
    return false;
  }

  const token = auth.slice(4);
  const expectedToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  return token === expectedToken;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  // Verify this is coming from our bot
  if (!verifyBotAuth(request, platform)) {
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
    // Build guild info from DB for template variables
    const [guildMeta, guildStats] = await Promise.all([
      getGuildMetadata(db, guildId).catch(() => null),
      getLatestServerStats(db, guildId).catch(() => null),
    ]);
    const guildInfo = {
      name: guildMeta?.name || "Unknown Server",
      member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
      human_count: guildStats?.human_count ?? null,
      bot_count: guildStats?.bot_count ?? null,
      boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
      boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
    };

    const context = buildContext(event, guildInfo);

    // Build filter context with actor/target roles for role-based filters
    const filterContext = {};

    // Check if any automation uses role-based filters
    const needsActorRoles = automations.some(a => 
      a.trigger_filters?.actor_has_role || a.trigger_filters?.actor_missing_role
    );
    const needsTargetRoles = automations.some(a => 
      a.trigger_filters?.target_has_role
    );

    // Fetch actor roles from event data or guild cache
    if (needsActorRoles && event.actor_id) {
      if (event.details?.actor_roles) {
        // Roles included in event data from gateway
        filterContext.actorRoles = event.details.actor_roles;
      } else {
        // Fall back to guild cache lookup
        try {
          const member = await getMemberFromCache(db, guildId, event.actor_id);
          if (member?.roles) {
            filterContext.actorRoles = member.roles;
          }
        } catch (err) {
          log.warn(`[Automation Process] Failed to fetch actor roles: ${err.message}`);
        }
      }
      log.debug(`[Automation Process] Actor roles: ${JSON.stringify(filterContext.actorRoles)}`);
    }

    // Fetch target roles from event data or guild cache
    if (needsTargetRoles && event.target_id) {
      if (event.details?.target_roles) {
        filterContext.targetRoles = event.details.target_roles;
      } else {
        try {
          const member = await getMemberFromCache(db, guildId, event.target_id);
          if (member?.roles) {
            filterContext.targetRoles = member.roles;
          }
        } catch (err) {
          log.warn(`[Automation Process] Failed to fetch target roles: ${err.message}`);
        }
      }
      log.debug(`[Automation Process] Target roles: ${JSON.stringify(filterContext.targetRoles)}`);
    }

    // Filter automations that match and prepare them for execution
    const matchingAutomations = automations
      .filter((automation) => {
        const matches = matchesFilters(event, automation.trigger_filters, filterContext);
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
