import { redirect } from "@sveltejs/kit";

/**
 * Discord Linked Roles - OAuth2 Callback
 *
 * After the user authorizes the linked role connection, Discord redirects here.
 * We exchange the code for a token, then push role connection metadata to Discord.
 */

/**
 * @param {string} name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function getEnv(name, platform) {
	return platform?.env?.[name];
}

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
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		console.error('[LinkedRole] OAuth error:', error, url.searchParams.get("error_description"));
		throw redirect(302, "/link-role-verify/result?error=denied");
	}

	if (!code) {
		throw redirect(302, "/link-role-verify/result?error=no_code");
	}

	// Verify CSRF state
	const savedState = cookies.get("oauth_state");
	if (!savedState || savedState !== state) {
		cookies.delete("oauth_state", { path: "/" });
		cookies.delete("oauth_flow", { path: "/" });
		throw redirect(302, "/link-role-verify/result?error=invalid_state");
	}
	cookies.delete("oauth_state", { path: "/" });
	cookies.delete("oauth_flow", { path: "/" });

	const CLIENT_ID = getEnv('DISCORD_CLIENT_ID', platform);
	const CLIENT_SECRET = getEnv('DISCORD_CLIENT_SECRET', platform);
	const REDIRECT_URI = `${getOrigin(request, url)}/link-role-verify/callback`;

	if (!CLIENT_ID || !CLIENT_SECRET) {
		throw redirect(302, "/link-role-verify/result?error=config");
	}

	try {
		// Exchange code for access token
		console.log('[LinkedRole] Exchanging code for token...');
		const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				grant_type: "authorization_code",
				code: code,
				redirect_uri: REDIRECT_URI,
			}),
		});

		if (!tokenResponse.ok) {
			const errorData = await tokenResponse.text();
			console.error('[LinkedRole] Token exchange failed:', errorData);
			throw redirect(302, "/link-role-verify/result?error=token_failed");
		}

		const tokenData = await tokenResponse.json();
		console.log('[LinkedRole] Token received');

		// Get user info for logging
		const userResponse = await fetch("https://discord.com/api/users/@me", {
			headers: { Authorization: `Bearer ${tokenData.access_token}` },
		});

		let username = "unknown";
		if (userResponse.ok) {
			const userData = await userResponse.json();
			username = userData.username;
			console.log('[LinkedRole] User:', userData.username, `(${userData.id})`);
		}

		// Push role connection metadata to Discord
		// This tells Discord to grant the linked role to this user
		const metadataResponse = await fetch(
			`https://discord.com/api/v10/users/@me/applications/${CLIENT_ID}/role-connection`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					platform_name: "SpaceBot",
					platform_username: username,
					metadata: {
						verified: 1,
					},
				}),
			}
		);

		if (!metadataResponse.ok) {
			const errorData = await metadataResponse.text();
			console.error('[LinkedRole] Metadata push failed:', metadataResponse.status, errorData);
			throw redirect(302, "/link-role-verify/result?error=metadata_failed");
		}

		console.log('[LinkedRole] Role connection metadata pushed successfully for', username);
		throw redirect(302, "/link-role-verify/result?success=true");
	} catch (error) {
		if (error?.status === 302) throw error; // Re-throw redirects
		console.error('[LinkedRole] Unexpected error:', error);
		throw redirect(302, "/link-role-verify/result?error=unexpected");
	}
}
