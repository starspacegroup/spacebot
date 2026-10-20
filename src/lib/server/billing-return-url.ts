/** Same-origin path or URL only; anything else falls back to the account page. */
export function safeBillingReturnUrl(returnUrl: unknown, origin: string, guildId: string): string {
	const fallback = `${origin}/admin/${guildId}/account`;
	if (typeof returnUrl !== 'string' || !returnUrl) return fallback;
	try {
		const parsed = new URL(returnUrl, origin);
		if (parsed.origin !== origin) return fallback;
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return fallback;
	}
}
