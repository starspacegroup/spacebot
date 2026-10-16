/**
 * `/start`: one door to every Activity-style feature a server has turned on.
 *
 * It has no row in `commands`. Its subcommands are built from the commands
 * that exist and are enabled in the server (`/timebox`, `/play`, `/quorum`), so a server
 * sees exactly what it can start, and the options of `/start timebox` are the
 * options of `/timebox start`, never a copy that can drift. The interaction is
 * turned back into the underlying command before anything else looks at it, so
 * the permission gate, the role rules and the handlers all stay where they are.
 */

type Option = Record<string, any>;
type DiscordCommand = Record<string, any>;

interface StartActivity {
	/** The subcommand's name under `/start`. */
	name: string;
	/** The command that does the work. */
	command: string;
	/** Its subcommand that starts the activity. */
	sub: string;
	description: string;
}

export const START_ACTIVITIES: StartActivity[] = [
	{
		name: 'timebox',
		command: 'timebox',
		sub: 'start',
		description: 'Start a focus timer: alone, or for everyone in your voice channel',
	},
	{
		name: 'agent',
		command: 'play',
		sub: 'start',
		description: 'Open a hidden-agent lobby for the voice channel you are in',
	},
	{
		name: 'quorum',
		command: 'quorum',
		sub: 'ask',
		description: 'Put a yes/no question to the server; it closes itself and posts the result',
	},
];

/** The options of one subcommand of a Discord command, or none. */
function subOptions(command: DiscordCommand, sub: string): Option[] {
	const found = (command.options as Option[] | undefined)?.find(
		(o) => o.type === 1 && o.name === sub
	);
	return found?.options ?? [];
}

/**
 * The `/start` command for a server, from the chat-input commands it already
 * has. Null when none of the activities is on.
 */
export function buildStartCommand(commands: DiscordCommand[]): DiscordCommand | null {
	const options: Option[] = [];
	for (const activity of START_ACTIVITIES) {
		const source = commands.find((c) => c.name === activity.command && (c.type ?? 1) === 1);
		if (!source) continue;
		const sub: Option = {
			name: activity.name,
			description: activity.description,
			type: 1,
		};
		const inner = subOptions(source, activity.sub);
		if (inner.length > 0) sub.options = inner;
		options.push(sub);
	}
	if (options.length === 0) return null;
	return {
		name: 'start',
		description: 'Start an Activity: a timebox, a game, and more',
		type: 1,
		options,
		dm_permission: false,
	};
}

/**
 * Turn `/start <activity> ...` into the command that does the work. Returns the
 * interaction data unchanged for anything else, and null for a subcommand that
 * is not one of ours.
 */
export function resolveStartInteraction(data: any): any | null {
	if (data?.name !== 'start') return data;
	const chosen = data.options?.find((o: Option) => o.type === 1);
	const activity = START_ACTIVITIES.find((a) => a.name === chosen?.name);
	if (!activity) return null;
	return {
		...data,
		name: activity.command,
		options: [{ type: 1, name: activity.sub, options: chosen.options ?? [] }],
	};
}
