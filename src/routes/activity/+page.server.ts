import { getEnv } from '$lib/env.js';

// The page needs the application id to start the Embedded App SDK. It is public
// (it is in every install link), so it is handed to the client here rather than
// baked into the build.
export function load({ platform }) {
	return { clientId: getEnv('DISCORD_CLIENT_ID', platform) ?? null };
}
