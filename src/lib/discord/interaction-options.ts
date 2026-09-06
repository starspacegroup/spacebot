/**
 * Interaction option flattening.
 *
 * Discord nests slash command options when a command uses subcommands: the
 * top-level option is `{ type: 1, name: "create", options: [...] }` (or a
 * `type: 2` group wrapping one of those) and it carries **no `value`**. Reading
 * `option.value` off the top level therefore produced `{ create: undefined }`
 * for `/room create name:Study`, and the real options were never seen.
 *
 * These helpers walk to the leaf options once and expose the invoked subcommand
 * path alongside them, so both the action executor and the template context see
 * the same flat shape regardless of whether a command uses subcommands.
 *
 * @see https://discord.com/developers/docs/interactions/application-commands#subcommands-and-subcommand-groups
 */

/** Discord option type for a subcommand. */
export const SUB_COMMAND = 1;
/** Discord option type for a subcommand group. */
export const SUB_COMMAND_GROUP = 2;
/** Discord option type for a user. */
export const USER_OPTION = 6;
/** Discord option type for a channel. */
export const CHANNEL_OPTION = 7;
/** Discord option type for a role. */
export const ROLE_OPTION = 8;

/**
 * Reserved option keys carrying the invoked subcommand. They are written last
 * so they always win over a same-named user option, because action conditions
 * branch on them and a silent collision would misroute a verb.
 */
export const SUBCOMMAND_KEY = '__subcommand';
export const SUBCOMMAND_GROUP_KEY = '__subcommand_group';
export const SUBCOMMAND_PATH_KEY = '__subcommand_path';

export interface FlattenedOptions {
	/** Leaf options in invocation order (never subcommands or groups). */
	leaves: Array<Record<string, any>>;
	/** Invoked subcommand name, or null for a flat command. */
	subcommand: string | null;
	/** Invoked subcommand group name, or null. */
	subcommandGroup: string | null;
	/** `group name` joined by a space, or just the name, or null. */
	subcommandPath: string | null;
}

/**
 * Walk an interaction's option tree down to the leaf options.
 *
 * @param data Interaction `data` payload (or anything with `.options`).
 */
export function flattenInteractionOptions(data: any): FlattenedOptions {
	const leaves: Array<Record<string, any>> = [];
	let subcommand: string | null = null;
	let subcommandGroup: string | null = null;

	const walk = (options: any) => {
		if (!Array.isArray(options)) return;
		for (const opt of options) {
			if (!opt || typeof opt !== 'object') continue;
			if (opt.type === SUB_COMMAND_GROUP) {
				subcommandGroup = opt.name ?? subcommandGroup;
				walk(opt.options);
			} else if (opt.type === SUB_COMMAND) {
				subcommand = opt.name ?? subcommand;
				walk(opt.options);
			} else {
				leaves.push(opt);
			}
		}
	};

	walk(data?.options);

	const subcommandPath = subcommand
		? subcommandGroup
			? `${subcommandGroup} ${subcommand}`
			: subcommand
		: null;

	return { leaves, subcommand, subcommandGroup, subcommandPath };
}

/**
 * Copy an interaction's options onto an action-executor event.
 *
 * Sets `event.options` by name, the reserved subcommand keys, and the legacy
 * `event.target_id` fallback (first USER option) that pre-subcommand commands
 * relied on.
 */
export function applyInteractionOptionsToEvent(event: any, data: any): FlattenedOptions {
	const flattened = flattenInteractionOptions(data);
	if (!event.options) event.options = {};

	for (const opt of flattened.leaves) {
		event.options[opt.name] = opt.value;

		// Legacy: map the first user option to target_id for backwards compatibility
		if (opt.type === USER_OPTION && !event.target_id) {
			event.target_id = opt.value;
		}
	}

	if (flattened.subcommand) {
		event.options[SUBCOMMAND_KEY] = flattened.subcommand;
		event.options[SUBCOMMAND_PATH_KEY] = flattened.subcommandPath;
		event.subcommand = flattened.subcommand;
		event.subcommand_path = flattened.subcommandPath;
	}
	if (flattened.subcommandGroup) {
		event.options[SUBCOMMAND_GROUP_KEY] = flattened.subcommandGroup;
		event.subcommand_group = flattened.subcommandGroup;
	}

	return flattened;
}

/**
 * Copy an interaction's options onto a template context (`{option.name}`).
 *
 * Mirrors {@link applyInteractionOptionsToEvent} so templates and actions never
 * disagree about what was passed.
 */
export function applyInteractionOptionsToContext(context: any, data: any): FlattenedOptions {
	const flattened = flattenInteractionOptions(data);
	if (!context.option) context.option = {};

	for (const opt of flattened.leaves) {
		context.option[opt.name] = opt.value;

		if (opt.type === USER_OPTION) {
			context.option[`${opt.name}_mention`] = `<@${opt.value}>`;
		} else if (opt.type === CHANNEL_OPTION) {
			context.option[`${opt.name}_mention`] = `<#${opt.value}>`;
		} else if (opt.type === ROLE_OPTION) {
			context.option[`${opt.name}_mention`] = `<@&${opt.value}>`;
		}
	}

	if (flattened.subcommand) {
		context.option[SUBCOMMAND_KEY] = flattened.subcommand;
		context.option[SUBCOMMAND_PATH_KEY] = flattened.subcommandPath;
	}
	if (flattened.subcommandGroup) {
		context.option[SUBCOMMAND_GROUP_KEY] = flattened.subcommandGroup;
	}

	context.subcommand = {
		name: flattened.subcommand || '',
		group: flattened.subcommandGroup || '',
		path: flattened.subcommandPath || '',
	};

	return flattened;
}
