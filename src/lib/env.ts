/**
 * Read an environment value from Cloudflare platform bindings or Node process
 * variables. Shared code uses this helper instead of assuming `process.env`.
 */
export function getEnv(name: string, platform?: any): string | undefined {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** Parse a boolean environment flag with common true values. */
export function getEnvBoolean(name: string, platform?: any, fallback = false): boolean {
	const value = getEnv(name, platform);
	if (value === undefined || value === null || value === '') return fallback;
	return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/** Parse a numeric environment value with a bounded fallback. */
export function getEnvNumber(name: string, platform: any, fallback: number): number {
	const parsed = Number(getEnv(name, platform));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
