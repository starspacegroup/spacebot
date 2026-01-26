import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, cookies, platform }) {
	const code = url.searchParams.get('code');
	
	if (!code) {
		throw redirect(302, '/login?error=no_code');
	}
	
	const CLIENT_ID = platform?.env?.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
	const CLIENT_SECRET = platform?.env?.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET;
	const REDIRECT_URI = `${url.origin}/api/auth/discord/callback`;
	
	if (!CLIENT_ID || !CLIENT_SECRET) {
		throw redirect(302, '/login?error=config');
	}
	
	try {
		// Exchange code for access token
		const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: REDIRECT_URI
			})
		});
		
		if (!tokenResponse.ok) {
			throw new Error('Failed to get token');
		}
		
		const tokenData = await tokenResponse.json();
		
		// Get user info
		const userResponse = await fetch('https://discord.com/api/users/@me', {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`
			}
		});
		
		if (!userResponse.ok) {
			throw new Error('Failed to get user info');
		}
		
		const userData = await userResponse.json();
		
		// TODO: Store user session in database or KV storage
		// For now, just set a cookie with user ID
		cookies.set('discord_user_id', userData.id, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 7 // 7 days
		});
		
		throw redirect(302, '/admin');
	} catch (error) {
		console.error('Auth error:', error);
		throw redirect(302, '/login?error=auth_failed');
	}
}
