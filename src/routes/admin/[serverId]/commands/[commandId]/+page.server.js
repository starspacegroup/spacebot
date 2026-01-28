import { error, fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  COMMAND_TEMPLATE_VARIABLES,
  COMMON_OPTION_TYPES,
  deleteCommand,
  getCommand,
  OPTION_TYPES,
  RESPONSE_TYPES,
  updateCommand,
} from "$lib/db/commands.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
  const parentData = await parent();

  // Require admin access
  if (!parentData.selectedGuildId) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;
  const commandId = parseInt(params.commandId);

  if (!db) {
    throw error(500, "Database not available");
  }

  if (isNaN(commandId)) {
    throw error(400, "Invalid command ID");
  }

  try {
    const command = await getCommand(
      db,
      commandId,
      parentData.selectedGuildId,
    );

    if (!command) {
      throw error(404, "Command not found");
    }

    return {
      command,
      // Meta info for the UI
      actionTypes: ACTION_TYPES,
      optionTypes: OPTION_TYPES,
      commonOptionTypes: COMMON_OPTION_TYPES,
      responseTypes: RESPONSE_TYPES,
      templateVariables: COMMAND_TEMPLATE_VARIABLES,
    };
  } catch (err) {
    if (err.status) throw err;
    console.error("Failed to load command:", err);
    throw error(500, "Failed to load command");
  }
}

/** @type {import('./$types').Actions} */
export const actions = {
  update: async ({ request, platform, params }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = params.commandId;
    const guildId = formData.get("guild_id");

    if (!id || !guildId) {
      return fail(400, { error: "Command ID and Guild ID are required" });
    }

    // Parse form data
    const updates = {};
    const name = formData.get("name");
    const description = formData.get("description");
    const ephemeral = formData.get("ephemeral") === "true";
    const defer = formData.get("defer") === "true";
    const actionType = formData.get("action_type");
    const responseType = formData.get("response_type");
    const responseContent = formData.get("response_content");

    if (name) {
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(name)) {
        return fail(400, { error: "Invalid command name format" });
      }
      updates.name = name.toLowerCase();
    }
    if (description !== null) updates.description = description;
    updates.ephemeral = ephemeral;
    updates.defer = defer;
    if (actionType) updates.action_type = actionType;
    if (responseType) updates.response_type = responseType;
    updates.response_content = responseContent || null;

    // Parse options from form
    const options = [];
    const optionNames = formData.getAll("option_name[]");
    const optionDescs = formData.getAll("option_description[]");
    const optionTypes = formData.getAll("option_type[]");
    const optionRequired = formData.getAll("option_required[]");

    for (let i = 0; i < optionNames.length; i++) {
      if (optionNames[i]) {
        options.push({
          name: optionNames[i].toLowerCase().replace(/\s+/g, "_"),
          description: optionDescs[i] || "No description",
          type: parseInt(optionTypes[i]) || 3,
          required: optionRequired.includes(String(i)),
        });
      }
    }
    updates.options = options;

    // Parse action config
    const actionConfig = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("action_config.")) {
        const configKey = key.replace("action_config.", "");
        actionConfig[configKey] = value;
      }
    }
    if (Object.keys(actionConfig).length > 0) {
      updates.action_config = actionConfig;
    }

    // Parse response embed if needed
    if (responseType === "embed") {
      const embedTitle = formData.get("embed_title");
      const embedDescription = formData.get("embed_description");
      const embedColor = formData.get("embed_color");

      if (embedTitle || embedDescription) {
        updates.response_embed = {
          title: embedTitle || undefined,
          description: embedDescription || undefined,
          color: embedColor
            ? parseInt(embedColor.replace("#", ""), 16)
            : 0x5865F2,
        };
      } else {
        updates.response_embed = null;
      }
    }

    try {
      const result = await updateCommand(db, parseInt(id), updates);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Redirect back to commands list on success
      throw redirect(302, `/admin/${params.serverId}/commands?updated=true`);
    } catch (err) {
      // Re-throw redirects
      if (err.status === 302) throw err;

      console.error("Update command error:", err);
      return fail(500, { error: "Failed to update command" });
    }
  },

  delete: async ({ request, platform, params }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    try {
      // Get command first to check for Discord registration
      const command = await getCommand(db, parseInt(params.commandId), guildId);

      const result = await deleteCommand(
        db,
        parseInt(params.commandId),
        guildId,
      );

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

      throw redirect(302, `/admin/${params.serverId}/commands?deleted=true`);
    } catch (err) {
      if (err.status === 302) throw err;
      console.error("Delete command error:", err);
      return fail(500, { error: "Failed to delete command" });
    }
  },
};
