/**
 * URLs that third parties supply and we render as links (security review
 * 2026-10-20, #14). Only https — or http on loopback for local development —
 * and never with embedded credentials. Anything else is not a link.
 */
export function isSafeLinkUrl(value: unknown): value is string {
	if (typeof value !== 'string' || !value) return false;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (url.protocol === 'https:') return true;
	return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
