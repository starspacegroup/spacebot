import { fail, redirect } from '@sveltejs/kit';
import {
	ACTION_TYPES,
	COMMAND_TEMPLATE_VARIABLES,
	COMMON_OPTION_TYPES,
	deleteCommand,
	getBuiltInCommandsForGuild,
	getCommandLogs,
	getGuildCommands,
	OPTION_TYPES,
	RESPONSE_TYPES,
} from '$lib/db/commands.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { log } from '$lib/db/logger.js';
import { setCommandEnabled } from '$lib/server/control-actions.js';

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

	const db = (platform as any)?.env?.DB;

	let commands = [];
	let builtInCmds = [];
	let recentLogs = [];

	if (db) {
		try {
			commands = await getGuildCommands(db, guildId);
			builtInCmds = await getBuiltInCommandsForGuild(db, guildId);

			// Get recent command logs
			const logsResult = await getCommandLogs(db, guildId, { limit: 10 });
			recentLogs = logsResult;
		} catch (error) {
			log.error('Failed to fetch commands:', error);
		}
	}

	return {
		commands,
		builtInCommands: builtInCmds,
		isSuperAdmin: parentData.isSuperAdmin || false,
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
	toggle: async ({ request, platform, params }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { error: 'Database not available' });
		}

		const formData = await request.formData();
		const id = formData.get('id');
		const guildId = params.serverId;
		const enabled = formData.get('enabled') === 'true';

		if (!id || !guildId) {
			return fail(400, { error: 'Command ID and Guild ID are required' });
		}

		try {
			// Built-ins toggle as a per-guild override. Which kind of command this is
			// comes from the command row, not from the form's is_built_in field.
			const result = await setCommandEnabled(
				db,
				(platform as any)?.env,
				guildId,
				parseInt(id as string),
				enabled
			);
			if (!result.ok) {
				return fail(result.status, { error: result.error });
			}

			return {
				success: true,
				message: enabled ? 'Command enabled & synced' : 'Command disabled & synced',
			};
		} catch (error) {
			log.error('Toggle command error:', error);
			return fail(500, { error: 'Failed to toggle command' });
		}
	},

	delete: async ({ request, platform, params }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) {
			return fail(500, { error: 'Database not available' });
		}

		const formData = await request.formData();
		const id = formData.get('id');
		const guildId = params.serverId;

		if (!id || !guildId) {
			return fail(400, { error: 'Command ID and Guild ID are required' });
		}

		try {
			const result = await deleteCommand(db, parseInt(id as string), guildId);

			if (!result.success) {
				return fail(500, { error: result.error });
			}

			// Auto-sync to Discord (the bulk PUT will remove the deleted command)
			await syncGuildCommands(db, guildId, (platform as any)?.env);

			return { success: true, message: 'Command deleted & synced!' };
		} catch (error) {
			log.error('Delete command error:', error);
			return fail(500, { error: 'Failed to delete command' });
		}
	},
};
