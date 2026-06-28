import { externalLinkState } from '$lib/community.js';
import { getEnv } from '$lib/env.js';

export function load({ platform }) {
	return externalLinkState(
		getEnv('PUBLIC_SUPPORT_DISCORD_URL', platform),
		'PUBLIC_SUPPORT_DISCORD_URL'
	);
}
