import { getUserProfile } from '$lib/db/profiles.js';

export async function load({ platform, params }) {
	const db = (platform as any)?.env?.DB;
	return {
		profile: await getUserProfile(db, params.guildId, params.userId),
	};
}
