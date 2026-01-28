/**
 * Automations API endpoint
 * GET - List automations for a guild
 * POST - Create a new automation
 */

import { json } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  createAutomation,
  FILTER_TYPES,
  getAutomations,
  TEMPLATE_VARIABLES,
} from "$lib/db/automations.js";
import { EVENT_CATEGORIES, EVENT_TYPES } from "$lib/db/logger.js";

/**
 * Verify user has admin access to the guild
 */
async function verifyGuildAdmin(guildId, accessToken) {
  if (!accessToken || !guildId) {
    return { authorized: false, error: "Unauthorized" };
  }

  try {
    // Fetch user's guilds from Discord
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      return { authorized: false, error: "Failed to verify permissions" };
    }

    const guilds = await response.json();
    const guild = guilds.find((g) => g.id === guildId);

    if (!guild) {
      return { authorized: false, error: "Guild not found" };
    }

    // Check for admin or manage guild permission
    const permissions = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);

    if ((permissions & ADMINISTRATOR) || (permissions & MANAGE_GUILD)) {
      return { authorized: true, guild };
    }

    return { authorized: false, error: "Insufficient permissions" };
  } catch (error) {
    console.error("Guild verification error:", error);
    return { authorized: false, error: "Verification failed" };
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const eventType = url.searchParams.get("eventType") || undefined;
  const enabled = url.searchParams.get("enabled");

  const { automations, total } = await getAutomations(db, guildId, {
    limit,
    offset,
    eventType,
    enabled: enabled !== null ? enabled === "true" : undefined,
  });

  return json({
    automations,
    total,
    pagination: {
      limit,
      offset,
      hasMore: offset + automations.length < total,
    },
    // Include metadata for UI
    meta: {
      actionTypes: ACTION_TYPES,
      filterTypes: FILTER_TYPES,
      eventTypes: EVENT_TYPES,
      eventCategories: EVENT_CATEGORIES,
      templateVariables: TEMPLATE_VARIABLES,
    },
  });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (
      !body.name || !body.trigger_event || !body.action_type ||
      !body.action_config
    ) {
      return json({
        error:
          "Missing required fields: name, trigger_event, action_type, action_config",
      }, { status: 400 });
    }

    // Validate trigger_event exists
    if (!EVENT_TYPES[body.trigger_event]) {
      return json({ error: `Invalid trigger_event: ${body.trigger_event}` }, {
        status: 400,
      });
    }

    // Validate action_type exists
    if (!ACTION_TYPES[body.action_type]) {
      return json({ error: `Invalid action_type: ${body.action_type}` }, {
        status: 400,
      });
    }

    // Get user ID from Discord
    let userId = null;
    try {
      const userResponse = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (userResponse.ok) {
        const user = await userResponse.json();
        userId = user.id;
      }
    } catch {
      // Continue without user ID
    }

    const result = await createAutomation(db, {
      guild_id: guildId,
      name: body.name,
      description: body.description,
      enabled: body.enabled !== false,
      trigger_event: body.trigger_event,
      trigger_filters: body.trigger_filters || null,
      action_type: body.action_type,
      action_config: body.action_config,
      created_by: userId,
    });

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({ success: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Create automation error:", error);
    return json({ error: "Failed to create automation" }, { status: 500 });
  }
}
