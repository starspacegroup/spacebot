/**
 * `/game` is one command for every game, and `/play` is its synonym.
 *
 * The built-in Game command row (migration 0083) holds the hidden-agent round
 * (`start`, `stop`, `status`) and Shiritori (`shiritori`). Where a server has
 * the *Space Game integration on, its manifest also declares a `/game`;
 * Discord allows one command per name, so its subcommands (`stats`,
 * `leaderboard`, `play`) are merged into the built-in one and routed back to
 * the integration by subcommand. `/play` is sent as a copy of the finished
 * `/game` with only its description changed, built here so the two cannot
 * drift, and the interactions route reads it as `/game`.
 */

type DiscordCommand = Record<string, any>;

export const GAME_COMMAND = 'game';
export const GAME_ALIAS = 'play';
export const GAME_ALIAS_DESCRIPTION = 'Same as /game';
/** Subcommands the built-in handlers own; anything else under /game is the integration's. */
export const BUILT_IN_GAME_SUBCOMMANDS = ['start', 'stop', 'status', 'shiritori'];

const isChatInput = (c: DiscordCommand) => (c?.type ?? 1) === 1;

/**
 * Merge the integration's `/game` into the built-in one and add `/play`.
 * `builtIn` and `integration` are Discord-format lists; both come back new,
 * the inputs are not changed. A built-in subcommand wins a name clash.
 */
export function unifyGameCommands(builtIn: DiscordCommand[], integration: DiscordCommand[]) {
	const own = builtIn.find((c) => c.name === GAME_COMMAND && isChatInput(c));
	const theirs = integration.find((c) => c.name === GAME_COMMAND && isChatInput(c));
	let outBuiltIn = builtIn.filter((c) => c.name !== GAME_ALIAS || !isChatInput(c));
	let outIntegration = integration;
	let game: DiscordCommand | undefined = own;

	if (own && theirs) {
		const taken = new Set((own.options ?? []).map((o: DiscordCommand) => o.name));
		const extra = (theirs.options ?? []).filter(
			(o: DiscordCommand) => (o.type === 1 || o.type === 2) && !taken.has(o.name)
		);
		game = { ...own, options: [...(own.options ?? []), ...extra] };
		outBuiltIn = outBuiltIn.map((c) => (c === own ? game! : c));
		outIntegration = integration.filter((c) => c !== theirs);
	} else if (!own && theirs) {
		game = theirs;
	}

	const alias = game ? [makeGameAlias(game)] : [];
	if (own || !theirs) outBuiltIn = [...outBuiltIn, ...alias];
	else outIntegration = [...outIntegration, ...alias];
	return { builtIn: outBuiltIn, integration: outIntegration };
}

/** `/play`: `/game` with its own name and description, nothing else. */
export function makeGameAlias(game: DiscordCommand): DiscordCommand {
	return { ...game, name: GAME_ALIAS, description: GAME_ALIAS_DESCRIPTION };
}

/** Read `/play …` as `/game …`. Anything else comes back unchanged. */
export function resolveGameAlias(data: any): any {
	if (data?.name !== GAME_ALIAS) return data;
	return { ...data, name: GAME_COMMAND };
}

/** The subcommand a `/game` interaction chose, or null. */
export function gameSubcommand(data: any): string | null {
	return data?.options?.find((o: any) => o.type === 1 || o.type === 2)?.name ?? null;
}

/** True when a `/game` interaction is for the built-in handlers, not the integration. */
export function isBuiltInGameInteraction(data: any): boolean {
	const sub = gameSubcommand(data);
	return sub !== null && BUILT_IN_GAME_SUBCOMMANDS.includes(sub);
}
