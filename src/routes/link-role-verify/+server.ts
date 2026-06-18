import { redirect } from "@sveltejs/kit";

/**
 * Discord Linked Roles Verification URL
 *
 * When a user clicks "Link" on a linked role in a Discord server,
 * Discord redirects them here. We then start an OAuth2 flow with
 * the `role_connections.write` and `identify` scopes to get permission
 * to update the user's role connection metadata.
 */

/**
 * Safely get environment variable from platform.env (Cloudflare Workers/Pages)
 * @param {string} name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function getEnv(name, platform) {
	return platform?.env?.[name];
}

/**
 * Get the real origin when behind a proxy/tunnel
 */
function getOrigin(request, url) {
	const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
	const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';

	if (forwardedHost && !forwardedHost.startsWith('localhost') && !forwardedHost.startsWith('127.')) {
		return `${forwardedProto}://${forwardedHost}`;
	}

	return url.origin;
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, url, cookies, platform }) {
	const CLIENT_ID = getEnv('DISCORD_CLIENT_ID', platform);
	const REDIRECT_URI = `${getOrigin(request, url)}/link-role-verify/callback`;

	if (!CLIENT_ID) {
		console.error('[LinkedRole] DISCORD_CLIENT_ID not configured');
		return new Response('Server configuration error', { status: 500 });
	}

	// Generate CSRF state
	const state = crypto.randomUUID();
	cookies.set("oauth_state", state, {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		maxAge: 60 * 10, // 10 minutes
	});

	// Store flow info
	cookies.set("oauth_flow", JSON.stringify({ flow: "linked-role" }), {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		maxAge: 60 * 10,
	});

	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		state: state,
		scope: "role_connections.write identify",
		prompt: "consent",
	});

	console.log('[LinkedRole] Redirecting to Discord OAuth2, redirect_uri:', REDIRECT_URI);
	throw redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
}
