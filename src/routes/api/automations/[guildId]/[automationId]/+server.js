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
  toggleAutomation,
  updateAutomation,
} from "$lib/db/automations.js";
import { EVENT_TYPES } from "$lib/db/logger.js";

/**
 * Verify user has admin access to the guild
 */
async function verifyGuildAdmin(guildId, accessToken) {
  if (!accessToken || !guildId) {
    return { authorized: false, error: "Unauthorized" };
  }

  try {
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
export async function GET({ params, cookies, platform }) {
  const { guildId, automationId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const automation = await getAutomation(db, parseInt(automationId), guildId);

  if (!automation) {
    return json({ error: "Automation not found" }, { status: 404 });
  }

  return json({ automation });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
  const { guildId, automationId } = params;
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
    const id = parseInt(automationId);

    // Check automation exists and belongs to guild
    const existing = await getAutomation(db, id, guildId);
    if (!existing) {
      return json({ error: "Automation not found" }, { status: 404 });
    }

    // Handle toggle action
    if (body.action === "toggle") {
      const result = await toggleAutomation(db, id, guildId, body.enabled);
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

    const result = await updateAutomation(db, id, body);

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({ success: true });
  } catch (error) {
    console.error("Update automation error:", error);
    return json({ error: "Failed to update automation" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform }) {
  const { guildId, automationId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const id = parseInt(automationId);

  // Check automation exists and belongs to guild
  const existing = await getAutomation(db, id, guildId);
  if (!existing) {
    return json({ error: "Automation not found" }, { status: 404 });
  }

  const result = await deleteAutomation(db, id, guildId);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  return json({ success: true });
}
