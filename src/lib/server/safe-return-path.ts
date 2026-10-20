/**
 * Post-login redirect targets (security review 2026-10-20, #17).
 *
 * `return_to` travels through a cookie the client controls, so it is validated
 * where it is used: only a root-relative path on this app survives. Absolute,
 * scheme-relative (`//`), backslash and control-character forms fall back.
 */
export function safeReturnPath(value: unknown, fallback = '/admin'): string {
	if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
	if (value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
	try {
		const parsed = new URL(value, 'http://spacebot.invalid');
		if (parsed.origin !== 'http://spacebot.invalid') return fallback;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}
