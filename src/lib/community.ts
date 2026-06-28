export function buildInviteUrl(clientId?: string, permissions = '8') {
	if (!clientId) return null;
	const url = new URL('https://discord.com/oauth2/authorize');
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('permissions', permissions);
	url.searchParams.set('integration_type', '0');
	url.searchParams.set('scope', 'bot applications.commands');
	return url.toString();
}

export function externalLinkState(url?: string | null, envName?: string) {
	return {
		enabled: Boolean(url),
		url: url || null,
		envName,
	};
}
