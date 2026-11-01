/**
 * Reading and writing a server's names for its games (`game_display_names`,
 * migration 0082). The rules are in `$lib/games/display.ts`.
 *
 * Reads never throw: a game post must not fail because this table could not be
 * read (or has not been migrated yet), so a failed read is the defaults.
 */

import { log } from '../log.js';
import {
	cleanIcon,
	cleanName,
	cleanTagline,
	defaultDisplays,
	resolveAll,
	resolveDisplay,
	type GameDisplay,
	type GameDisplayRow,
} from '../games/display.js';
import { findGame } from '../games/registry.js';

async function rows(db, guildId: string): Promise<GameDisplayRow[]> {
	const res = await db
		.prepare(`SELECT game_id, name, icon, tagline FROM game_display_names WHERE guild_id = ?`)
		.bind(guildId)
		.all();
	return (res?.results ?? []) as GameDisplayRow[];
}

/** Every game's name, icon and tagline on this server. */
export async function getGameDisplays(db, guildId: string): Promise<Record<string, GameDisplay>> {
	if (!db || !guildId) return defaultDisplays();
	try {
		return resolveAll(await rows(db, guildId));
	} catch (err: any) {
		log.debug(`[Games] Could not read display names for ${guildId}: ${err?.message}`);
		return defaultDisplays();
	}
}

/** One game's name, icon and tagline on this server, or the defaults. */
export async function getGameDisplay(db, guildId: string, gameId: string): Promise<GameDisplay> {
	const all = await getGameDisplays(db, guildId);
	return all[gameId] ?? (resolveDisplay(gameId, null) as GameDisplay);
}

export type SaveResult = { ok: true; display: GameDisplay } | { ok: false; error: string };

/**
 * Save what the dashboard sent for one game. Empty fields reset to the default;
 * all three empty removes the row.
 */
export async function saveGameDisplay(
	db,
	guildId: string,
	gameId: string,
	input: { name?: unknown; icon?: unknown; tagline?: unknown }
): Promise<SaveResult> {
	const game = findGame(gameId);
	if (!game) return { ok: false, error: 'Unknown game.' };
	const name = cleanName(input.name);
	const icon = cleanIcon(input.icon);
	const tagline = cleanTagline(input.tagline);
	for (const c of [name, icon, tagline]) if ('error' in c) return { ok: false, error: c.error };
	const value = (c: typeof name) => (c.ok ? c.value : null);
	// Typing the default back in is the same as leaving it empty.
	const n = value(name) === game.name ? null : value(name);
	const i = value(icon) === game.icon ? null : value(icon);
	const t = value(tagline) === game.tagline ? null : value(tagline);

	if (n === null && i === null && t === null) {
		await db
			.prepare(`DELETE FROM game_display_names WHERE guild_id = ? AND game_id = ?`)
			.bind(guildId, game.id)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO game_display_names (guild_id, game_id, name, icon, tagline, updated_at)
				 VALUES (?, ?, ?, ?, ?, datetime('now'))
				 ON CONFLICT(guild_id, game_id) DO UPDATE SET
				   name = excluded.name, icon = excluded.icon, tagline = excluded.tagline,
				   updated_at = excluded.updated_at`
			)
			.bind(guildId, game.id, n, i, t)
			.run();
	}
	return {
		ok: true,
		display: resolveDisplay(game.id, {
			game_id: game.id,
			name: n,
			icon: i,
			tagline: t,
		}) as GameDisplay,
	};
}

/**
 * Put the server's game names into its built-in command descriptions, which
 * are synced per server (docs/command-sync.md) and listed by `/help`. Command
 * NAMES never change. Returns new command objects; the input is not touched.
 */
export function applyDisplaysToCommands<T extends Record<string, any>>(
	commands: T[],
	displays: Record<string, GameDisplay>
): T[] {
	const agent = displays.agent;
	const shiritori = displays.shiritori;
	if (!agent?.custom.name && !shiritori?.custom.name) return commands;
	return commands.map((cmd) => {
		if (cmd?.name !== 'play') return cmd;
		let options = cmd.options;
		if (typeof options === 'string') {
			try {
				options = JSON.parse(options);
			} catch {
				options = null;
			}
		}
		const fit = (s: string) => (s.length > 100 ? `${s.slice(0, 99)}…` : s);
		const next: Record<string, any> = { ...cmd };
		if (agent?.custom.name) {
			next.description = fit(`${agent.name}: a round for everyone in your voice channel`);
		}
		if (Array.isArray(options)) {
			next.options = options.map((o: any) => {
				if (o?.name === 'start' && agent?.custom.name) {
					return {
						...o,
						description: fit(`Open a ${agent.name} lobby for your voice channel`),
					};
				}
				if (o?.name === 'shiritori' && shiritori?.custom.name) {
					return {
						...o,
						description: fit(`Open a ${shiritori.name} round in this channel`),
					};
				}
				return o;
			});
		}
		return next as T;
	});
}
