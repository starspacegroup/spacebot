/**
 * Handling Discord names that contain markdown characters.
 *
 * Server, channel, role and event names are free text. Real ones routinely
 * contain `*`, `_`, `|`, `~`, backticks and brackets — `*Space` is a real
 * server, and the asterisk is part of the name, not decoration.
 *
 * That breaks in two independent places, and both need fixing or the name is
 * lost somewhere in the round trip:
 *
 * 1. **Into the model.** The prompt used to write `### ${guild.name} [badges]`,
 *    dropping the name bare into a markdown heading immediately before a
 *    bracketed list. There is no boundary marking where the name ends, so
 *    `*Space` looks like emphasis, `[Test] Server` collides with the badges,
 *    and `Server | Community` collides with the badge separator. The model then
 *    "tidies" the name and replies about a server called Space.
 *
 * 2. **Out to Discord.** Discord renders the bot's message as markdown, so a
 *    raw `*` in composed text is consumed as emphasis and never reaches the
 *    reader.
 */

/**
 * Backslash-escape the characters Discord treats as markdown, so a name renders
 * exactly as it is written.
 *
 * Escape the backslash first, or escaping the rest would double-mangle it.
 */
export function escapeDiscordMarkdown(text: string | null | undefined): string {
	return String(text ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/([*_~`|>#\-[\]()])/g, '\\$1');
}

/**
 * Render a name for the model so its boundaries are unambiguous.
 *
 * JSON quoting is doing real work here rather than being decorative: it
 * delimits the value, and it escapes embedded quotes and backslashes, so there
 * is exactly one reading of where the name starts and stops no matter what
 * characters it contains.
 */
export function quoteNameForPrompt(name: string | null | undefined): string {
	return JSON.stringify(String(name ?? ''));
}

/**
 * Compare two names for practical equality.
 *
 * Models drop punctuation — that is the whole reason this module exists — so a
 * lookup must still resolve when the model echoes `*Space` back as `Space`.
 * Case, surrounding whitespace, markdown punctuation and internal runs of
 * whitespace are all ignored; the letters and digits are what identify a name.
 */
export function normalizeNameForMatch(name: string | null | undefined): string {
	return String(name ?? '')
		.toLowerCase()
		.replace(/[\\*_~`|>#[\]()]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Whether two names refer to the same thing once punctuation noise is ignored. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
	const left = normalizeNameForMatch(a);
	const right = normalizeNameForMatch(b);
	return left.length > 0 && left === right;
}

/**
 * Everything a query could plausibly mean, best tier first.
 *
 * Tiered so a precise match always beats a loose one: id, then exact name, then
 * punctuation-insensitive, then contains. The first tier that matches anything
 * wins outright — otherwise "Space" would drag in "Space Station" alongside an
 * exact hit on a server actually called Space.
 *
 * Returning the whole list (rather than the first hit) is the point: the caller
 * can tell "one answer" from "several", instead of silently taking whichever
 * happened to be first in the array.
 */
export function findGuildMatches<T extends { id?: string; name?: string }>(
	guilds: T[],
	query: string | null | undefined
): T[] {
	const list = (guilds || []).filter(Boolean);
	const raw = String(query ?? '').trim();
	if (!raw) return [];

	const byId = list.filter((g) => g?.id && g.id === raw);
	if (byId.length) return byId;

	const exact = list.filter((g) => g?.name === raw);
	if (exact.length) return exact;

	const normalized = list.filter((g) => namesMatch(g?.name, raw));
	if (normalized.length) return normalized;

	const needle = normalizeNameForMatch(raw);
	if (!needle) return [];
	return list.filter((g) => normalizeNameForMatch(g?.name).includes(needle));
}

/**
 * Resolve a guild by whatever the user or model called it.
 *
 * `*Space`, `Space` and `space` all reach the same server, but an ambiguous
 * query resolves to **nothing** rather than to a guess: acting on the wrong
 * server is far worse than asking which one was meant.
 */
export function resolveGuildByName<T extends { id?: string; name?: string }>(
	guilds: T[],
	query: string | null | undefined
): T | null {
	const matches = findGuildMatches(guilds, query);
	return matches.length === 1 ? matches[0] : null;
}
