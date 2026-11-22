/** True when a command's options include subcommands or subcommand groups (types 1 and 2). */
export function hasSubcommands(options: unknown): boolean {
	return Array.isArray(options) && options.some((o) => o && (o.type === 1 || o.type === 2));
}

/** A stored `options` column as an array. Anything that does not parse gives none. */
export function parseStoredOptions(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw !== 'string') return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
