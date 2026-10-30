/**
 * Read an integer query parameter, clamped to [min, max].
 * Junk, empty or missing values fall back to `fallback`. A raw parseInt would
 * pass NaN or a negative number into SQL (`LIMIT -1` means "no limit").
 */
export function intParam(
	url: URL,
	name: string,
	fallback: number,
	min: number,
	max: number = Number.MAX_SAFE_INTEGER
): number {
	const parsed = parseInt(url.searchParams.get(name) || '', 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}
