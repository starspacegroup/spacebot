/**
 * Single automation API endpoint
 * GET - Get automation details
 * PATCH - Update automation
 * DELETE - Delete automation
 */

import { json } from "@sveltejs/kit";
import {
  deleteAutomation,
  getAutomation,
  getAutomations,
  toggleAutomation,
  updateAutomation,
} from "$lib/db/automations.js";
import { EVENT_TYPES, log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { checkPlanLimit } from "$lib/db/server-plans.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId, automationId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  // automationId can be either numeric ID or public_id hash
  const automation = await getAutomation(db, automationId, guildId);

  if (!automation) {
    return json({ error: "Automation not found" }, { status: 404 });
  }

  return json({ automation });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
  const { guildId, automationId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Check automation exists and belongs to guild (supports both numeric ID and public_id)
    const existing = await getAutomation(db, automationId, guildId);
    if (!existing) {
      return json({ error: "Automation not found" }, { status: 404 });
    }

    // Handle toggle action
    if (body.action === "toggle") {
      // If enabling, check plan limits
      if (body.enabled) {
        try {
          const activeResult = await getAutomations(db, guildId, { enabled: true, limit: 1000 });
          const activeCount = activeResult.automations?.length || 0;
          const planCheck = await checkPlanLimit(db, guildId, 'automations', activeCount);
          if (!planCheck.allowed) {
            return json({ error: `Automation limit reached (${planCheck.current}/${planCheck.limit}). Upgrade your plan or disable another automation first.` }, { status: 403 });
          }
        } catch (err) {
          log.warn("Plan limit check failed, allowing toggle:", err);
        }
      }
      const result = await toggleAutomation(db, automationId, guildId, body.enabled);
      if (!result.success) {
        return json({ error: "Failed to toggle automation" }, { status: 500 });
      }
      return json({ success: true, enabled: body.enabled });
    }

    // Validate trigger_event if provided
    if (body.trigger_event && !EVENT_TYPES[body.trigger_event]) {
      return json({ error: `Invalid trigger_event: ${body.trigger_event}` }, {
        status: 400,
      });
    }

    const result = await updateAutomation(db, automationId, body, guildId);

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({ success: true });
  } catch (error) {
    log.error("Update automation error:", error);
    return json({ error: "Failed to update automation" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform }) {
  const { guildId, automationId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  // Check automation exists and belongs to guild (supports both numeric ID and public_id)
  const existing = await getAutomation(db, automationId, guildId);
  if (!existing) {
    return json({ error: "Automation not found" }, { status: 404 });
  }

  const result = await deleteAutomation(db, automationId, guildId);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  return json({ success: true });
}
