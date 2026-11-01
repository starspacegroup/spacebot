/**
 * The games SpaceBot plays, as the dashboard lists them.
 *
 * One entry per game. The Activity admin page draws a card from each entry, in
 * this order, and the server reads `enable` to know where the game's on/off
 * switch is stored. Adding a game is one entry here, plus its settings
 * component in `GAME_SETTINGS` (src/lib/components/activity-admin/game-settings.ts)
 * when it has settings, plus a reader in `src/lib/server/games-admin.ts` when its
 * switch is a setting rather than a command.
 *
 * Pure data, no Svelte and no database, so the edge app, the tests and the
 * page all read the same list.
 */

/** Where a game's on/off switch lives. Existing storage, never a new column. */
export type GameEnable =
	/** The per-server override of a built-in command (`built_in_command_overrides`). */
	| { kind: 'command'; command: string }
	/** The game's own `enabled` setting. `store` names its settings module. */
	| { kind: 'setting'; store: 'shiritori' };

export interface GameDefinition {
	/** Stable id: form values, anchors and the settings map use it. */
	id: string;
	name: string;
	/** One emoji. Decorative: the name always sits beside it. */
	icon: string;
	/** One line: what the game is. */
	tagline: string;
	/** Who plays, e.g. `3–15 players`. */
	players: string;
	/** Where it is played. */
	where: string;
	/** The commands members type, shown as written. */
	commands: string[];
	/** `planned` games show as Coming soon, with no switch and no settings. */
	status: 'live' | 'planned';
	/** Absent only for a planned game. */
	enable?: GameEnable;
	/**
	 * A built-in command the game also needs on, when its own switch is not that
	 * command. Shiritori rounds start with `/game`, so they need the Game command.
	 */
	needsCommand?: string;
	/** The doc in `docs/` that explains it. */
	doc: string;
}

export const GAMES: readonly GameDefinition[] = [
	{
		id: 'agent',
		name: 'Hidden Agent',
		icon: '🕵️',
		tagline:
			'Everyone but one is told a secret word. Talk it out, call a vote, and eject who you think the agent is.',
		players: '3–15 players',
		where: 'A voice channel, played in the Activity',
		commands: ['/game start', '/start agent'],
		status: 'live',
		// `/game` is also the Activity's `game` module switch (ACTIVITY_MODULES).
		enable: { kind: 'command', command: 'game' },
		doc: 'game.md',
	},
	{
		id: 'shiritori',
		name: 'Shiritori',
		icon: '🔤',
		tagline:
			'The word chain: each word starts with the last letter of the one before, and no word is used twice.',
		players: 'Anyone in the Chain channel; 2–12 in a round',
		where: 'A Chain channel, or a timed round in any text or voice chat',
		commands: ['/game shiritori'],
		status: 'live',
		enable: { kind: 'setting', store: 'shiritori' },
		needsCommand: 'game',
		doc: 'shiritori.md',
	},
];

/** The game with this id, or undefined. */
export function findGame(id: unknown, games: readonly GameDefinition[] = GAMES) {
	return typeof id === 'string' ? games.find((g) => g.id === id) : undefined;
}

/** Built-in commands that are a game's switch. The Tools list leaves these out. */
export function gameCommands(games: readonly GameDefinition[] = GAMES): Set<string> {
	const out = new Set<string>();
	for (const g of games) if (g.enable?.kind === 'command') out.add(g.enable.command);
	return out;
}

/**
 * Check a registry for mistakes a new entry could make. Returns the problems;
 * the tests require none for `GAMES`.
 */
export function registryProblems(games: readonly GameDefinition[]): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	for (const g of games) {
		if (!/^[a-z][a-z0-9-]*$/.test(g.id)) problems.push(`${g.id}: id is not a slug`);
		if (ids.has(g.id)) problems.push(`${g.id}: duplicate id`);
		ids.add(g.id);
		if (!g.name || !g.tagline || !g.players || !g.where) {
			problems.push(`${g.id}: name, tagline, players and where are required`);
		}
		if (g.status === 'live' && !g.enable) problems.push(`${g.id}: a live game needs a switch`);
		if (g.status === 'planned' && g.enable) {
			problems.push(`${g.id}: a planned game has no switch yet`);
		}
		for (const c of g.commands) {
			if (!c.startsWith('/')) problems.push(`${g.id}: command "${c}" must start with /`);
		}
	}
	return problems;
}
