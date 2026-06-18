import { error, fail, redirect } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  BUILT_IN_GUILD_ID,
  COMMAND_TEMPLATE_VARIABLES,
  COMMAND_USER_SOURCES,
  COMMON_OPTION_TYPES,
  deleteCommand,
  getBuiltInCommand,
  getBuiltInCommandForGuild,
  getCommand,
  OPTION_TYPES,
  PERMISSION_FLAGS,
  PERMISSION_PRESETS,
  RESPONSE_TYPES,
  setBuiltInCommandOverride,
  updateCommand,
} from "$lib/db/commands.js";
import { syncGuildCommands } from "$lib/discord/commands.js";
import { getGuildWebhooks } from "$lib/db/webhooks.js";
import { log } from "$lib/db/logger.js";

interface CommandOptionChoice {
  name: string;
  value: string | number;
}

interface CommandOptionUpdate {
  name: string;
  description: string;
  type: number;
  required: boolean;
  default?: string;
  choices?: CommandOptionChoice[];
}

interface CommandUpdates {
  name?: string;
  description?: FormDataEntryValue;
  ephemeral?: boolean;
  defer?: boolean;
  context_menu_user?: boolean;
  require_voice?: boolean;
  action_type?: string;
  response_type?: string;
  response_content?: FormDataEntryValue | null;
  options?: CommandOptionUpdate[];
  actions?: Array<Record<string, any>>;
  response_embed?: Record<string, any> | null;
  default_member_permissions?: FormDataEntryValue | null;
  dm_permission?: boolean;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params, url }) {
  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();
  const guildId = params.serverId;

  // Require admin access - check that user has access to this guild
  if (!parentData.adminGuilds?.some(g => g.id === guildId) && !parentData.isSuperAdmin) {
    throw redirect(302, "/admin");
  }

  const db = (platform as any)?.env?.DB;
  const commandId = parseInt(params.commandId);

  if (!db) {
    throw error(500, "Database not available");
  }

  if (isNaN(commandId)) {
    throw error(400, "Invalid command ID");
  }

  try {
    const isBuiltIn = url?.searchParams?.get("builtin") === "true";
    let command;

    if (isBuiltIn) {
      command = await getBuiltInCommandForGuild(db, guildId, commandId);
    } else {
      command = await getCommand(db, commandId, guildId);
    }

    if (!command) {
      throw error(404, "Command not found");
    }

    // If it's a built-in command loaded via regular path, require explicit builtin query.
    if (!isBuiltIn && command.is_built_in && !parentData.isSuperAdmin) {
      throw redirect(302, `/admin/${params.serverId}/commands`);
    }

    // Load webhooks for this guild
    const webhooks = await getGuildWebhooks(db, guildId);
    const enabledWebhooks = webhooks.filter(w => w.enabled).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      method: w.method,
    }));

    return {
      command,
      isSuperAdmin: parentData.isSuperAdmin || false,
      // Meta info for the UI
      actionTypes: ACTION_TYPES,
      optionTypes: OPTION_TYPES,
      commonOptionTypes: COMMON_OPTION_TYPES,
      responseTypes: RESPONSE_TYPES,
      templateVariables: COMMAND_TEMPLATE_VARIABLES,
      userSources: COMMAND_USER_SOURCES,
      permissionFlags: PERMISSION_FLAGS,
      permissionPresets: PERMISSION_PRESETS,
      webhooks: enabledWebhooks,
    };
  } catch (err) {
    if (err.status) throw err;
    log.error("Failed to load command:", err);
    throw error(500, "Failed to load command");
  }
}

/** @type {import('./$types').Actions} */
export const actions = {
  update: async ({ request, platform, params, cookies }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const id = params.commandId;
    const guildId = formData.get("guild_id");
    const isBuiltIn = formData.get("is_built_in") === "true";

    if (!id || !guildId) {
      return fail(400, { error: "Command ID and Guild ID are required" });
    }

    const userId = cookies.get("discord_user_id");
    const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
    const superAdminIdList = adminUserIds.split(",").map(id => id.trim()).filter(Boolean);
    const isSuperAdmin = superAdminIdList.includes(userId);

    // Built-in commands support per-guild permission overrides for server admins.
    // Full built-in command editing remains superadmin-only.
    if (isBuiltIn) {
      const defaultMemberPermissions = (formData.get("default_member_permissions") as string | null) || null;

      if (!isSuperAdmin) {
        const result = await setBuiltInCommandOverride(
          db,
          params.serverId,
          parseInt(id),
          { default_member_permissions: defaultMemberPermissions },
        );

        if (!result.success) {
          return fail(500, { error: result.error || "Failed to update built-in command permissions" });
        }

        await syncGuildCommands(db, params.serverId, (platform as any)?.env);
        throw redirect(302, `/admin/${params.serverId}/commands?updated=true`);
      }

      // Superadmins editing built-ins from this route should update the global command row.
      formData.set("guild_id", BUILT_IN_GUILD_ID);
    }

    // Parse form data
    const updates: CommandUpdates = {};
    const name = formData.get("name");
    const description = formData.get("description");
    const ephemeral = formData.get("ephemeral") === "true";
    const defer = formData.get("defer") === "true";
    const contextMenuUser = formData.get("context_menu_user") === "true";
    const requireVoice = formData.get("require_voice") === "true";
    const actionType = formData.get("action_type");
    const responseType = formData.get("response_type");
    const responseContent = formData.get("response_content");

    if (name) {
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(name as string)) {
        return fail(400, { error: "Invalid command name format" });
      }
      updates.name = (name as string).toLowerCase();
    }
    if (description !== null) updates.description = description;
    updates.ephemeral = ephemeral;
    updates.defer = defer;
    updates.context_menu_user = contextMenuUser;
    updates.require_voice = requireVoice;
    if (actionType) updates.action_type = actionType as string;
    if (responseType) updates.response_type = responseType as string;
    updates.response_content = responseContent || null;

    // Parse options from form
    const options = [];
    const optionNames = formData.getAll("option_name[]");
    const optionDescs = formData.getAll("option_description[]");
    const optionTypes = formData.getAll("option_type[]");
    const optionRequired = formData.getAll("option_required[]");
    const optionDefaults = formData.getAll("option_default[]");

    // Helper to convert UI type values to Discord type values
    const getDiscordType = (uiType) => {
      const typeVal = parseInt(uiType) || 3;
      // Map UI choice types to Discord types
      if (typeVal === 103) return 3;  // CHOICE_TEXT → STRING
      if (typeVal === 104) return 4;  // CHOICE_INTEGER → INTEGER
      return typeVal;
    };

    let defaultIndex = 0;
    for (let i = 0; i < optionNames.length; i++) {
      if (optionNames[i]) {
        const isRequired = optionRequired.includes(String(i));
        let type = getDiscordType(optionTypes[i]);
        
        const option: CommandOptionUpdate = {
          name: (optionNames[i] as string).toLowerCase().replace(/\s+/g, "_"),
          description: (optionDescs[i] as string) || "No description",
          type: type,
          required: isRequired,
        };

        // Only non-required options have default values in the form
        if (!isRequired && optionDefaults[defaultIndex]) {
          option.default = optionDefaults[defaultIndex] as string;
        }
        if (!isRequired) {
          defaultIndex++;
        }
        
        // Parse choices if present
        const choiceNames = formData.getAll(`option_choice_name[${i}][]`);
        const choiceValues = formData.getAll(`option_choice_value[${i}][]`);
        if (choiceNames.length > 0) {
          option.choices = [];
          for (let j = 0; j < choiceNames.length; j++) {
            if (choiceNames[j] && choiceValues[j]) {
              option.choices.push({
                name: choiceNames[j] as string,
                value: type === 4 ? parseInt(choiceValues[j] as string) : (choiceValues[j] as string)
              });
            }
          }
        }
        
        options.push(option);
      }
    }
    updates.options = options;

    // Parse stacked actions (new format: action_type[] and action_config.{index}.{key})
    const actionTypes = formData.getAll("action_type[]");
    const actions = [];

    for (let i = 0; i < actionTypes.length; i++) {
      if (actionTypes[i]) {
        const actionConfig = {};
        for (const [key, value] of formData.entries()) {
          const prefix = `action_config.${i}.`;
          if (key.startsWith(prefix)) {
            const configKey = key.replace(prefix, "");
            actionConfig[configKey] = value;
          }
        }

        const group = (formData.get(`action_group.${i}`) || "default")
          .toString()
          .trim() || "default";
        const conditionMode = (formData.get(`action_condition_mode.${i}`) ||
          "always").toString();
        const conditionOption = (formData.get(`action_condition_option.${i}`) ||
          "").toString().trim();
        const conditionValue = (formData.get(`action_condition_value.${i}`) ||
          "").toString();

        actions.push({
          type: actionTypes[i],
          config: actionConfig,
          group,
          condition: {
            mode: conditionMode,
            option: conditionOption,
            value: conditionValue,
          },
        });
      }
    }

    // Store actions as the new format
    updates.actions = actions;
    // For backwards compatibility, also set legacy action_type field
    if (actions.length === 1) {
      updates.action_type = actions[0].type;
      // Don't set action_config here - it will be built in updateCommand
    } else if (actions.length === 0) {
      updates.action_type = "NONE";
    } else {
      updates.action_type = "MULTIPLE";
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
            ? parseInt((embedColor as string).replace("#", ""), 16)
            : 0x5865F2,
        };
      } else {
        updates.response_embed = null;
      }
    }

    // Parse permissions
    const defaultMemberPermissions = formData.get("default_member_permissions") || null;
    updates.default_member_permissions = defaultMemberPermissions;
    updates.dm_permission = false; // Guild commands typically don't work in DMs

    try {
      const result = await updateCommand(db, parseInt(id), updates);

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Auto-sync to Discord (use the actual serverId for sync, not __built_in__)
      const syncGuildId = isBuiltIn ? params.serverId : guildId;
      await syncGuildCommands(db, syncGuildId, (platform as any)?.env);

      // Redirect back to commands list on success
      throw redirect(302, `/admin/${params.serverId}/commands?updated=true`);
    } catch (err) {
      // Re-throw redirects
      if (err.status === 302) throw err;

      log.error("Update command error:", err);
      return fail(500, { error: "Failed to update command" });
    }
  },

  delete: async ({ request, platform, params }) => {
    const db = (platform as any)?.env?.DB;
    if (!db) {
      return fail(500, { error: "Database not available" });
    }

    const formData = await request.formData();
    const guildId = formData.get("guild_id");

    if (!guildId) {
      return fail(400, { error: "Guild ID is required" });
    }

    try {
      const result = await deleteCommand(
        db,
        parseInt(params.commandId),
        guildId,
      );

      if (!result.success) {
        return fail(500, { error: result.error });
      }

      // Auto-sync to Discord (the bulk PUT will remove the deleted command)
      await syncGuildCommands(db, guildId, (platform as any)?.env);

      throw redirect(302, `/admin/${params.serverId}/commands?deleted=true`);
    } catch (err) {
      if (err.status === 302) throw err;
      log.error("Delete command error:", err);
      return fail(500, { error: "Failed to delete command" });
    }
  },
};
