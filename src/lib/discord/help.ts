/**
 * The `/help` listing.
 *
 * Every server gets `/help`, and it answers one question: what can *I* run
 * here? So the list is built from the guild's real command set and then
 * filtered by the invoking member's own permissions — a moderator and an
 * ordinary member asking the same question get different answers, and neither
 * gets a list of things they cannot use.
 *
 * Pure on purpose: the caller fetches, this shapes. Nothing here touches D1 or
 * Discord.
 */

import { memberHasCommandPermission } from './command-permissions.js';
import { SUB_COMMAND, SUB_COMMAND_GROUP } from './interaction-options.js';

/** Discord's cap on an embed field value. */
const FIELD_VALUE_LIMIT = 1024;
/** Discord's cap on fields in one embed. */
const MAX_FIELDS = 25;

export interface HelpEntry {
	name: string;
	description: string;
	/** `create`, `owner transfer` — the invocable leaves under a family. */
	subcommands: string[];
	source: 'built-in' | 'server' | 'integration';
}

/** Walk a command's options down to its invocable subcommand paths. */
export function subcommandPaths(options: any, prefix = ''): string[] {
	if (!Array.isArray(options)) return [];

	const paths: string[] = [];
	for (const option of options) {
		const type = Number(option?.type);
		const name = String(option?.name || '').trim();
		if (!name) continue;

		if (type === SUB_COMMAND) {
			paths.push(prefix ? `${prefix} ${name}` : name);
		} else if (type === SUB_COMMAND_GROUP) {
			paths.push(...subcommandPaths(option.options, prefix ? `${prefix} ${name}` : name));
		}
	}
	return paths;
}

/** Turn a guild's commands into the entries a member is allowed to see. */
export function buildHelpEntries(
	{ builtIn = [], custom = [], integration = [] }: Record<string, any[]>,
	memberPermissions: unknown
): HelpEntry[] {
	const entries: HelpEntry[] = [];

	const add = (command: any, source: HelpEntry['source']) => {
		const name = String(command?.name || '').trim();
		if (!name) return;

		// Discord gates on this too, but its gate is advisory and ours is the
		// one that decides whether the command would actually run.
		if (!memberHasCommandPermission(memberPermissions, command?.default_member_permissions)) {
			return;
		}

		entries.push({
			name,
			description: String(command?.description || '').trim() || 'No description',
			subcommands: subcommandPaths(command?.options),
			source,
		});
	};

	// `toDiscordCommand` always emits the slash form, adding context-menu
	// entries alongside it, so every command here is something a member can type.
	for (const command of builtIn) add(command, 'built-in');
	for (const command of custom) add(command, 'server');
	for (const command of integration) add(command, 'integration');

	// Stable, and alphabetical is what somebody scanning a list wants.
	entries.sort((a, b) => a.name.localeCompare(b.name));

	// One command can be registered from more than one source; the first wins.
	const seen = new Set<string>();
	return entries.filter((entry) => {
		const key = entry.name.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** One embed field per command, with its subcommands underneath. */
function entryToField(entry: HelpEntry) {
	const lines = [entry.description];

	if (entry.subcommands.length > 0) {
		lines.push(...entry.subcommands.map((path) => `• \`/${entry.name} ${path}\``));
	}

	let value = lines.join('\n');
	if (value.length > FIELD_VALUE_LIMIT) {
		value = `${value.slice(0, FIELD_VALUE_LIMIT - 1)}…`;
	}

	return { name: `/${entry.name}`, value, inline: false };
}

/**
 * The ephemeral embed `/help` replies with.
 *
 * Discord caps an embed at 25 fields. A guild with more commands than that
 * gets the overflow as a plain list in the last field rather than a silently
 * truncated one — a member who cannot see a command in help concludes it does
 * not exist.
 */
export function buildHelpEmbed(entries: HelpEntry[], guildName?: string | null) {
	const title = guildName ? `Commands in ${guildName}` : 'Commands';

	if (entries.length === 0) {
		return {
			title,
			description:
				'There are no commands you can use here yet. A server admin sets them up in the SpaceBot dashboard.',
			color: 0x5865f2,
		};
	}

	const shown = entries.slice(0, MAX_FIELDS - 1);
	const overflow = entries.slice(MAX_FIELDS - 1);
	const fields = shown.map(entryToField);

	if (overflow.length > 0) {
		let value = overflow.map((entry) => `\`/${entry.name}\``).join(', ');
		if (value.length > FIELD_VALUE_LIMIT) {
			value = `${value.slice(0, FIELD_VALUE_LIMIT - 1)}…`;
		}
		fields.push({ name: `And ${overflow.length} more`, value, inline: false });
	}

	const plural = entries.length === 1 ? 'command' : 'commands';

	return {
		title,
		description: `${entries.length} ${plural} you can use. Only you can see this.`,
		color: 0x5865f2,
		fields,
	};
}
