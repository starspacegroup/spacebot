import { fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  COMMAND_TEMPLATE_VARIABLES,
  COMMON_OPTION_TYPES,
  createCommand,
  OPTION_TYPES,
  RESPONSE_TYPES,
} from "$lib/db/commands.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent }) {
  const parentData = await parent();

  // Require admin access
  if (!parentData.selectedGuildId) {
    throw redirect(302, "/admin");
  }

  return {
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
  default: async ({ request, cookies, platform, params }) => {
    const db = platform?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");
    const userId = cookies.get("discord_user_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    // Parse form data
    const name = formData.get("name");
    const description = formData.get("description");
    const ephemeral = formData.get("ephemeral") === "true";
    const defer = formData.get("defer") === "true";
    const actionType = formData.get("action_type") || "NONE";
    const responseType = formData.get("response_type") || "message";
    const responseContent = formData.get("response_content");

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

    // Parse action config from form
    const actionConfig = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("action_config.")) {
        const configKey = key.replace("action_config.", "");
        actionConfig[configKey] = value;
      }
    }

    // Parse response embed if needed
    let responseEmbed = null;
    if (responseType === "embed") {
      const embedTitle = formData.get("embed_title");
      const embedDescription = formData.get("embed_description");
      const embedColor = formData.get("embed_color");

      if (embedTitle || embedDescription) {
        responseEmbed = {
          title: embedTitle || undefined,
          description: embedDescription || undefined,
          color: embedColor
            ? parseInt(embedColor.replace("#", ""), 16)
            : 0x5865F2,
        };
      }
    }

    // Validation
    if (!name || !description) {
      return fail(400, {
        error: "Name and description are required",
        values: { name, description, actionType },
      });
    }

    // Validate command name
    const nameRegex = /^[\w-]{1,32}$/;
    if (!nameRegex.test(name)) {
      return fail(400, {
        error:
          "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
        values: { name, description, actionType },
      });
    }

    try {
      const result = await createCommand(db, {
        guild_id: guildId,
        name: name.toLowerCase(),
        description,
        enabled: true,
        options: options.length > 0 ? options : [],
        ephemeral,
        defer,
        action_type: actionType,
        action_config: actionConfig,
        response_type: responseType,
        response_content: responseContent || null,
        response_embed: responseEmbed,
        created_by: userId,
      });

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Redirect back to commands list on success
      throw redirect(302, `/admin/${params.serverId}/commands?created=true`);
    } catch (error) {
      // Re-throw redirects
      if (error.status === 302) throw error;

      console.error("Create command error:", error);
      return fail(500, { error: "Failed to create command" });
    }
  },
};
