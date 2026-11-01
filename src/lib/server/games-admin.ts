/**
 * Reading and flipping a game's on/off switch for the Activity admin page.
 *
 * The registry (`$lib/games/registry.ts`) says where each switch lives; this is
 * the code that reads and writes it there. Nothing new is stored: a command
 * switch is the same built-in command override `/play` always used, and a
 * setting switch is the game's own `enabled` column.
 */

import { getBuiltInCommandsForGuild, setBuiltInCommandOverride } from '../db/commands.js';
import { GAMES, type GameDefinition } from '../games/registry.js';
import {
	getSettings as getShiritoriSettings,
	upsertSettings as upsertShiritoriSettings,
} from './shiritori-game.js';

/** A built-in command as the page sees it: its name and whether it is on here. */
export interface CommandSwitch {
	name: string;
	enabled: boolean;
}

export interface GameState {
	id: string;
	/** Planned games are always false. */
	enabled: boolean;
	/** The command named by `needsCommand` is off, so part of the game cannot start. */
	blockedBy: string | null;
}

const SETTING_STORES = {
	shiritori: {
		get: async (db, guildId: string) => (await getShiritoriSettings(db, guildId)).enabled,
		set: async (db, guildId: string, enabled: boolean) => {
			const current = await getShiritoriSettings(db, guildId);
			await upsertShiritoriSettings(db, guildId, { ...current, enabled });
		},
	},
} as const;

function commandOn(commands: CommandSwitch[], name: string) {
	return Boolean(commands.find((c) => c.name === name)?.enabled);
}

/** Every game's switch for one server, in registry order. */
export async function loadGameStates(
	db,
	guildId: string,
	commands: CommandSwitch[],
	games: readonly GameDefinition[] = GAMES
): Promise<GameState[]> {
	const out: GameState[] = [];
	for (const g of games) {
		let enabled = false;
		if (g.enable?.kind === 'command') enabled = commandOn(commands, g.enable.command);
		else if (g.enable?.kind === 'setting' && db) {
			enabled = await SETTING_STORES[g.enable.store].get(db, guildId);
		}
		const blockedBy =
			enabled && g.needsCommand && !commandOn(commands, g.needsCommand)
				? g.needsCommand
				: null;
		out.push({ id: g.id, enabled, blockedBy });
	}
	return out;
}

export type SetResult =
	| { ok: true; /** A command changed, so Discord's command list needs a sync. */ sync: boolean }
	| { ok: false; status: number; message: string };

/** Turn one game on or off where its switch lives. */
export async function setGameEnabled(
	db,
	guildId: string,
	game: GameDefinition,
	enabled: boolean
): Promise<SetResult> {
	const enable = game.enable;
	if (!enable || game.status !== 'live') {
		return { ok: false, status: 400, message: `${game.name} is not available yet.` };
	}
	if (enable.kind === 'setting') {
		await SETTING_STORES[enable.store].set(db, guildId, enabled);
		return { ok: true, sync: false };
	}
	const command = (await getBuiltInCommandsForGuild(db, guildId)).find(
		(c) => c.name === enable.command
	);
	if (!command) return { ok: false, status: 404, message: `/${enable.command} is missing.` };
	const result = await setBuiltInCommandOverride(db, guildId, command.id, { enabled });
	if (!result.success) return { ok: false, status: 400, message: result.error };
	return { ok: true, sync: true };
}
