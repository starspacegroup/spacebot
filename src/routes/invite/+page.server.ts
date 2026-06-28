import { buildInviteUrl } from '$lib/community.js';
import { getEnv } from '$lib/env.js';

export function load({ platform }) {
	const clientId = getEnv('DISCORD_CLIENT_ID', platform);
	const permissions = getEnv('DISCORD_INVITE_PERMISSIONS', platform) || '8';
	return {
		inviteUrl: buildInviteUrl(clientId, permissions),
		clientIdConfigured: Boolean(clientId),
		permissions,
	};
}
