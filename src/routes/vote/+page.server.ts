import { externalLinkState } from '$lib/community.js';
import { getEnv } from '$lib/env.js';

export function load({ platform }) {
	return {
		vote: externalLinkState(getEnv('PUBLIC_BOT_VOTE_URL', platform), 'PUBLIC_BOT_VOTE_URL'),
		review: externalLinkState(
			getEnv('PUBLIC_BOT_REVIEW_URL', platform),
			'PUBLIC_BOT_REVIEW_URL'
		),
	};
}
