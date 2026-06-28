import { error } from '@sveltejs/kit';
import { getUserProfile } from '$lib/db/profiles.js';

export async function load({ platform, params }) {
	const db = (platform as any)?.env?.DB;
	const profile = await getUserProfile(db, params.guildId, params.userId);
	// Privacy: do not expose a profile (bio, display name, badges, stats) unless
	// the user has explicitly opted into a public profile. Avoids an IDOR where
	// any guild/user id pair could be enumerated.
	if (!profile.public_profile) {
		throw error(404, 'Profile not found');
	}
	return { profile };
}
