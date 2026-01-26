import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, platform }) {
	const CLIENT_ID = platform?.env?.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
	const REDIRECT_URI = `${url.origin}/api/auth/discord/callback`;
	
	if (!CLIENT_ID) {
		throw new Error('DISCORD_CLIENT_ID not configured');
	}
	
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'identify guilds'
	});
	
	throw redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
}
