/**
 * Presentation helpers for the public server browser.
 *
 * DB-free on purpose so both the browse grid and the detail page can import
 * them — they were duplicated in each component, which is exactly how the two
 * copies drift apart.
 */

/**
 * Initials for a server with no icon.
 *
 * Iterates code points rather than UTF-16 units: `'🎮 Gaming'[0]` is a lone
 * high surrogate that renders as ‘�’, and Discord server names lead with an
 * emoji constantly.
 */
export function serverInitials(name: string): string {
	return String(name || '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => {
			const first = Array.from(word)[0];
			return first ? first.toUpperCase() : '';
		})
		.join('');
}

/** Stable hue per guild, so a server's fallback art doesn't change between renders. */
export function serverHue(guildId: string): number {
	let hash = 0;
	for (let i = 0; i < guildId.length; i++) {
		hash = (hash * 31 + guildId.charCodeAt(i)) % 360;
	}
	return hash;
}

/** Compact member counts: 1.2k, 45k, 1.3M. */
export function formatMemberCount(value: number | null | undefined): string | null {
	const count = Number(value || 0);
	if (!count) return null;
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 10_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}
