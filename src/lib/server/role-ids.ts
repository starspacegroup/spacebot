/** Role ids from a comma-separated form value: real snowflakes only, no repeats, at most 50. */
export function parseRoleIds(raw: unknown): string[] {
	return [
		...new Set(
			String(raw ?? '')
				.split(',')
				.map((id) => id.trim())
				.filter((id) => /^\d{17,20}$/.test(id))
		),
	].slice(0, 50);
}
