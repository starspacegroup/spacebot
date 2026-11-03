/**
 * What a game is called on one server.
 *
 * A server can rename a game, give it its own icon and its own one-line
 * description. The registry (`./registry.ts`) holds the defaults; a server's
 * choices are stored per game id (`game_display_names`, migration 0082) and read
 * through `src/lib/server/game-display.ts`.
 *
 * Everything here is pure: the cleaning rules, and the merge of a stored row
 * with the default. A cleaned value carries no mention, link, markdown or
 * control character, so it can go straight into a Discord message, an embed or
 * a command description without escaping.
 */

import { GAMES, findGame, type GameDefinition } from './registry.js';

export const NAME_MAX = 40;
export const TAGLINE_MAX = 120;

/** What members see for one game in one server. */
export interface GameDisplay {
	id: string;
	name: string;
	icon: string;
	tagline: string;
	/** Which fields the server set, so the dashboard can offer Reset. */
	custom: { name: boolean; icon: boolean; tagline: boolean };
}

/** A stored row; null columns mean the default. */
export interface GameDisplayRow {
	game_id: string;
	name: string | null;
	icon: string | null;
	tagline: string | null;
}

export type Clean = { ok: true; value: string | null } | { ok: false; error: string };

// Control and format characters (bidi overrides, zero-width joiners outside
// emoji are dropped with them), and the characters Discord markdown or a
// mention is built from. Parentheses stay: without `[` they make no link.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MARKUP = /[*_~`|\\<>[\]#@]/g;
const LINK =
	/(?:https?|ftp):|www\.|discord(?:app)?\.(?:gg|com)|\b[a-z0-9-]+\.(?:com|net|org|gg|io|xyz|ly|me|co|app|dev|link|site)\b/i;

/**
 * Clean free text for a name or tagline. Empty means "use the default" and
 * comes back as `null`.
 */
export function cleanText(input: unknown, max: number, label = 'Name'): Clean {
	const raw = typeof input === 'string' ? input : '';
	if (LINK.test(raw)) return { ok: false, error: `${label} cannot contain a link.` };
	const text = raw.replace(CONTROL, ' ').replace(MARKUP, '').replace(/\s+/g, ' ').trim();
	if (!text) return { ok: true, value: null };
	if ([...text].length > max) {
		return { ok: false, error: `${label} must be ${max} characters or fewer.` };
	}
	return { ok: true, value: text };
}

export const cleanName = (input: unknown) => cleanText(input, NAME_MAX, 'Name');
export const cleanTagline = (input: unknown) => cleanText(input, TAGLINE_MAX, 'Description');

const PICTO = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣)/u;

/** One emoji, or empty for the default. */
export function cleanIcon(input: unknown): Clean {
	const raw = (typeof input === 'string' ? input : '').trim();
	if (!raw) return { ok: true, value: null };
	const parts = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(raw)];
	if (parts.length !== 1 || raw.length > 16 || !PICTO.test(raw)) {
		return { ok: false, error: 'Icon must be a single emoji.' };
	}
	return { ok: true, value: raw };
}

/** The default merged with what the server set. Unknown ids come back null. */
export function resolveDisplay(
	gameId: string,
	row: Partial<GameDisplayRow> | null | undefined,
	games: readonly GameDefinition[] = GAMES
): GameDisplay | null {
	const game = findGame(gameId, games);
	if (!game) return null;
	// Stored rows are cleaned on the way in; clean again so a row written any
	// other way still cannot carry markup into a message.
	const name = row?.name ? cleanName(row.name) : null;
	const icon = row?.icon ? cleanIcon(row.icon) : null;
	const tagline = row?.tagline ? cleanTagline(row.tagline) : null;
	const pick = (c: Clean | null) => (c && c.ok && c.value ? c.value : null);
	const n = pick(name);
	const i = pick(icon);
	const t = pick(tagline);
	return {
		id: game.id,
		name: n ?? game.name,
		icon: i ?? game.icon,
		tagline: t ?? game.tagline,
		custom: { name: n !== null, icon: i !== null, tagline: t !== null },
	};
}

/** Every game's display for one server, from its stored rows. */
export function resolveAll(
	rows: readonly Partial<GameDisplayRow>[],
	games: readonly GameDefinition[] = GAMES
): Record<string, GameDisplay> {
	const out: Record<string, GameDisplay> = {};
	for (const g of games) {
		out[g.id] = resolveDisplay(
			g.id,
			rows.find((r) => r.game_id === g.id),
			games
		) as GameDisplay;
	}
	return out;
}

/** The defaults, for when nothing could be read. */
export function defaultDisplays(games: readonly GameDefinition[] = GAMES) {
	return resolveAll([], games);
}
