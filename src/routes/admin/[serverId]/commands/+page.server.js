import { fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  COMMAND_TEMPLATE_VARIABLES,
  COMMON_OPTION_TYPES,
  createCommand,
  deleteCommand,
  getCommand,
  getCommandLogs,
  getGuildCommands,
  OPTION_TYPES,
  RESPONSE_TYPES,
  updateCommand,
} from "$lib/db/commands.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, url }) {
  const parentData = await parent();

  // Require admin access
  if (!parentData.selectedGuildId) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;
  const guildId = parentData.selectedGuildId;

  let commands = [];
  let recentLogs = [];

  if (db) {
    try {
      commands = await getGuildCommands(db, guildId);

      // Get recent command logs
      const logsResult = await getCommandLogs(db, guildId, { limit: 10 });
      recentLogs = logsResult;
    } catch (error) {
      console.error("Failed to fetch commands:", error);
    }
  }

  return {
    commands,
    total: commands.length,
    recentLogs,
    // Meta info for the UI
    actionTypes: ACTION_TYPES,
    optionTypes: OPTION_TYPES,
    commonOptionTypes: COMMON_OPTION_TYPES,
    responseTypes: RESPONSE_TYPES,
    templateVariables: COMMAND_TEMPLATE_VARIABLES,
  };
}

/** @type {import('./$types').Actions} */
export const actions = {
  toggle: async ({ request, platform }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = formData.get("id");
    const guildId = formData.get("guild_id");
    const enabled = formData.get("enabled") === "true";

    if (!id || !guildId) {
      return fail(400, { error: "Command ID and Guild ID are required" });
    }

    try {
      const result = await updateCommand(db, parseInt(id), { enabled });

      if (!result.success) {
        return fail(500, { error: "Failed to toggle command" });
      }

      return {
        success: true,
        message: enabled ? "Command enabled" : "Command disabled",
      };
    } catch (error) {
      console.error("Toggle command error:", error);
      return fail(500, { error: "Failed to toggle command" });
    }
  },

  delete: async ({ request, platform }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = formData.get("id");
    const guildId = formData.get("guild_id");

    if (!id || !guildId) {
      return fail(400, { error: "Command ID and Guild ID are required" });
    }

    try {
      // Get command to check for Discord command ID
      const command = await getCommand(db, parseInt(id), guildId);

      const result = await deleteCommand(db, parseInt(id), guildId);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // If command was registered with Discord, unregister it
      if (command?.discord_command_id) {
        try {
          const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
            process.env.DISCORD_BOT_TOKEN;
          const clientId = platform?.env?.DISCORD_CLIENT_ID ||
            process.env.DISCORD_CLIENT_ID;

          if (botToken && clientId) {
            await fetch(
              `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands/${command.discord_command_id}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bot ${botToken}`,
                },
              },
            );
          }
        } catch (error) {
          console.error("Failed to unregister command from Discord:", error);
        }
      }

      return { success: true, message: "Command deleted successfully!" };
    } catch (error) {
      console.error("Delete command error:", error);
      return fail(500, { error: "Failed to delete command" });
    }
  },

  register: async ({ request, platform }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;
    const clientId = platform?.env?.DISCORD_CLIENT_ID ||
      process.env.DISCORD_CLIENT_ID;

    if (!botToken || !clientId) {
      return fail(500, { error: "Bot configuration not available" });
    }

    try {
      // Fetch commands and register them
      const response = await fetch(`/api/commands/${guildId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sync" }),
      });

      if (!response.ok) {
        const error = await response.json();
        return fail(500, {
          error: error.error || "Failed to register commands",
        });
      }

      const result = await response.json();
      return {
        success: true,
        message:
          `Successfully registered ${result.registered} commands with Discord!`,
      };
    } catch (error) {
      console.error("Register commands error:", error);
      return fail(500, { error: "Failed to register commands" });
    }
  },
};
