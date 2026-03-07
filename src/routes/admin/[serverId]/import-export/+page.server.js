import { redirect } from "@sveltejs/kit";
import { getAutomations } from "$lib/db/automations.js";
import { getGuildCommands } from "$lib/db/commands.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ platform, parent, params }) {
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();
  const guildId = params.serverId;

  if (!parentData.adminGuilds?.some(g => g.id === guildId) && !parentData.isSuperAdmin) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;

  let automations = [];
  let commands = [];

  if (db) {
    try {
      const result = await getAutomations(db, guildId, { limit: 1000 });
      automations = result.automations;
    } catch (error) {
      log.error("Failed to fetch automations for export:", error);
    }

    try {
      const allCommands = await getGuildCommands(db, guildId);
      commands = allCommands.filter(c => !c.is_built_in);
    } catch (error) {
      log.error("Failed to fetch commands for export:", error);
    }
  }

  return {
    automations,
    commands,
    selectedGuildId: guildId,
  };
}
