import { fail, redirect } from '@sveltejs/kit';
import {
	ACTION_TYPES,
	COMMAND_TEMPLATE_VARIABLES,
	COMMAND_USER_SOURCES,
	COMMON_OPTION_TYPES,
	createCommand,
	getGuildCommands,
	OPTION_TYPES,
	PERMISSION_FLAGS,
	PERMISSION_PRESETS,
	RESPONSE_TYPES,
} from '$lib/db/commands.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { getGuildWebhooks } from '$lib/db/webhooks.js';
import { getGuildContributedActions } from '$lib/db/integrations.js';
import { log } from '$lib/db/logger.js';
import { checkPlanLimit } from '$lib/db/server-plans.js';

/** Shape of a command option assembled from the submitted form data. */
interface CommandOption {
	name: string;
	description: FormDataEntryValue;
	type: number;
	required: boolean;
	default?: FormDataEntryValue;
	choices?: Array<{ name: FormDataEntryValue; value: string | number }>;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ platform, parent, params }) {
	// Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
	if (!/^\d{17,20}$/.test(params.serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();
	const guildId = params.serverId;

	// Require admin access - check that user has access to this guild
	if (!parentData.adminGuilds?.some((g) => g.id === guildId) && !parentData.isSuperAdmin) {
		throw redirect(302, '/admin');
	}

	// Load webhooks for this guild
	const db = (platform as any)?.env?.DB;
	const webhooks = db ? await getGuildWebhooks(db, guildId) : [];
	const enabledWebhooks = webhooks
		.filter((w) => w.enabled)
		.map((w) => ({
			id: w.id,
			name: w.name,
			description: w.description,
			method: w.method,
		}));

	// Merge in actions contributed by this guild's enabled integrations so they
	// appear alongside the built-in action types in the builder.
	const contributedActions = db ? await getGuildContributedActions(db, guildId) : {};

	return {
		// Meta info for the UI
		actionTypes: { ...ACTION_TYPES, ...contributedActions },
		optionTypes: OPTION_TYPES,
		commonOptionTypes: COMMON_OPTION_TYPES,
		responseTypes: RESPONSE_TYPES,
		templateVariables: COMMAND_TEMPLATE_VARIABLES,
		userSources: COMMAND_USER_SOURCES,
		permissionFlags: PERMISSION_FLAGS,
		permissionPresets: PERMISSION_PRESETS,
		webhooks: enabledWebhooks,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	default: async ({ request, cookies, platform, params }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { error: 'Database not available' });
		}

		const formData = await request.formData();
		const guildId = formData.get('guild_id');
		const userId = cookies.get('discord_user_id');

		if (!guildId) {
			return fail(400, { error: 'Guild ID is required' });
		}

		// Parse form data
		const name = formData.get('name');
		const description = formData.get('description');
		const ephemeral = formData.get('ephemeral') === 'true';
		const ephemeralOption = (formData.get('ephemeral_option') as string) || null;
		const defer = formData.get('defer') === 'true';
		const contextMenuUser = formData.get('context_menu_user') === 'true';
		const requireVoice = formData.get('require_voice') === 'true';
		const responseType = formData.get('response_type') || 'message';
		const responseContent = formData.get('response_content');

		// Parse options from form
		const options = [];
		const optionNames = formData.getAll('option_name[]');
		const optionDescs = formData.getAll('option_description[]');
		const optionTypes = formData.getAll('option_type[]');
		const optionRequired = formData.getAll('option_required[]');
		const optionDefaults = formData.getAll('option_default[]');

		// Helper to convert UI type values to Discord type values
		const getDiscordType = (uiType) => {
			const typeVal = parseInt(uiType) || 3;
			// Map UI choice types to Discord types
			if (typeVal === 103) return 3; // CHOICE_TEXT → STRING
			if (typeVal === 104) return 4; // CHOICE_INTEGER → INTEGER
			return typeVal;
		};

		let defaultIndex = 0;
		for (let i = 0; i < optionNames.length; i++) {
			if (optionNames[i]) {
				const isRequired = optionRequired.includes(String(i));
				const type = getDiscordType(optionTypes[i]);

				const option: CommandOption = {
					name: String(optionNames[i]).toLowerCase().replace(/\s+/g, '_'),
					description: optionDescs[i] || 'No description',
					type: type,
					required: isRequired,
				};

				// Only non-required options have default values in the form
				if (!isRequired && optionDefaults[defaultIndex]) {
					option.default = optionDefaults[defaultIndex];
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
								name: choiceNames[j],
								value:
									type === 4
										? parseInt(String(choiceValues[j]))
										: String(choiceValues[j]),
							});
						}
					}
				}

				options.push(option);
			}
		}

		// Parse stacked actions (new format: action_type[] and action_config.{index}.{key})
		const actionTypes = formData.getAll('action_type[]');
		const actions = [];

		for (let i = 0; i < actionTypes.length; i++) {
			if (actionTypes[i]) {
				const actionConfig = {};
				for (const [key, value] of formData.entries()) {
					const prefix = `action_config.${i}.`;
					if (key.startsWith(prefix)) {
						const configKey = key.replace(prefix, '');
						actionConfig[configKey] = value;
					}
				}

				const group =
					(formData.get(`action_group.${i}`) || 'default').toString().trim() || 'default';
				const conditionMode = (
					formData.get(`action_condition_mode.${i}`) || 'always'
				).toString();
				const conditionOption = (formData.get(`action_condition_option.${i}`) || '')
					.toString()
					.trim();
				const conditionValue = (
					formData.get(`action_condition_value.${i}`) || ''
				).toString();

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

		// Determine action_type and action_config for backwards compatibility
		let actionType = 'NONE';
		// Store the actions array in action_config wrapper - don't spread config to avoid issues
		const actionConfig = { actions };

		if (actions.length === 1) {
			actionType = actions[0].type;
		} else if (actions.length > 1) {
			actionType = 'MULTIPLE';
		}

		// Parse response embed if needed
		let responseEmbed = null;
		if (responseType === 'embed') {
			const embedTitle = formData.get('embed_title');
			const embedDescription = formData.get('embed_description');
			const embedColor = formData.get('embed_color');

			if (embedTitle || embedDescription) {
				responseEmbed = {
					title: embedTitle || undefined,
					description: embedDescription || undefined,
					color: embedColor
						? parseInt(String(embedColor).replace('#', ''), 16)
						: 0x5865f2,
				};
			}
		}

		// Validation
		if (!name || !description) {
			return fail(400, {
				error: 'Name and description are required',
				values: { name, description },
			});
		}

		// Validate command name
		const nameRegex = /^[\w-]{1,32}$/;
		if (!nameRegex.test(String(name))) {
			return fail(400, {
				error: 'Command name must be 1-32 characters, lowercase, alphanumeric or hyphens',
				values: { name, description },
			});
		}

		try {
			// Parse permissions
			const defaultMemberPermissions = formData.get('default_member_permissions') || null;

			// Check plan limits — if over quota, create as disabled
			const allCommands = await getGuildCommands(db, guildId, { enabledOnly: true });
			const activeCount = allCommands.length;
			const planCheck = await checkPlanLimit(db, guildId, 'commands', activeCount);
			const enabledByDefault = planCheck.allowed;

			const result = await createCommand(db, {
				guild_id: guildId,
				name: String(name).toLowerCase(),
				description,
				enabled: enabledByDefault,
				options: options.length > 0 ? options : [],
				ephemeral,
				ephemeral_option: ephemeralOption,
				defer,
				action_type: actionType,
				action_config: actionConfig,
				response_type: responseType,
				response_content: responseContent || null,
				response_embed: responseEmbed,
				default_member_permissions: defaultMemberPermissions,
				dm_permission: false, // Guild commands typically don't work in DMs
				context_menu_user: contextMenuUser,
				require_voice: requireVoice,
				created_by: userId,
			});

			if (!result.success) {
				return fail(500, { error: result.error });
			}

			// Auto-sync to Discord
			await syncGuildCommands(db, guildId, (platform as any)?.env);

			// Redirect back to commands list on success (note if created disabled due to quota)
			const createdParam = enabledByDefault ? 'created=true' : 'created=disabled';
			throw redirect(302, `/admin/${params.serverId}/commands?${createdParam}`);
		} catch (error) {
			// Re-throw redirects
			if (error.status === 302) throw error;

			log.error('Create command error:', error);
			return fail(500, { error: 'Failed to create command' });
		}
	},
};
