/**
 * What the Shiritori API routes share: bot-token auth (the gateway calls them
 * with the same `Bot <token>` header it uses for /api/logs/create) and the REST
 * client the game posts through.
 */
import { getEnv } from '../env.js';
import { createDiscordRestClient } from '../discord/rest-client.js';

/** Compare without stopping at the first differing character. */
function sameToken(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export function botAuthorized(request: Request, platform: any): boolean {
	const auth = request.headers.get('Authorization');
	if (!auth?.startsWith('Bot ')) return false;
	const expected = getEnv('DISCORD_BOT_TOKEN', platform);
	return Boolean(expected) && sameToken(auth.slice(4), expected as string);
}

export function discordFor(platform: any) {
	const token = getEnv('DISCORD_BOT_TOKEN', platform);
	return token ? createDiscordRestClient(token) : null;
}
