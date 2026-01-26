import { redirect } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, cookies, platform }) {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	// Handle user cancellation or errors from Discord
	if (error) {
		console.error("OAuth error from Discord:", error, errorDescription);
		throw redirect(302, `/login?error=${error}`);
	}

	if (!code) {
		throw redirect(302, "/login?error=no_code");
	}

	// Verify state parameter for CSRF protection
	const savedState = cookies.get("oauth_state");
	if (!savedState || savedState !== state) {
		cookies.delete("oauth_state", { path: "/" });
		cookies.delete("oauth_flow", { path: "/" });
		throw redirect(302, "/login?error=invalid_state");
	}
	cookies.delete("oauth_state", { path: "/" });

	// Get the flow type from the saved state
	let flowData = { flow: "login", returnTo: "/" };
	try {
		const savedFlow = cookies.get("oauth_flow");
		if (savedFlow) {
			flowData = JSON.parse(savedFlow);
		}
	} catch {
		// Use defaults if parsing fails
	}
	cookies.delete("oauth_flow", { path: "/" });

	const CLIENT_ID = platform?.env?.DISCORD_CLIENT_ID ||
		process.env.DISCORD_CLIENT_ID;
	const CLIENT_SECRET = platform?.env?.DISCORD_CLIENT_SECRET ||
		process.env.DISCORD_CLIENT_SECRET;
	const REDIRECT_URI = `${url.origin}/api/auth/discord/callback`;

	if (!CLIENT_ID || !CLIENT_SECRET) {
		throw redirect(302, "/login?error=config");
	}

	try {
		// Exchange code for access token
		// This is the critical step for OAuth2 Code Grant - we get the token
		// BEFORE the bot is added to the server (for install flow)
		const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
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
			console.error("Token exchange failed:", errorData);
			throw new Error("Failed to get token");
		}

		const tokenData = await tokenResponse.json();

		// Get user info
		const userResponse = await fetch("https://discord.com/api/users/@me", {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
			},
		});

		if (!userResponse.ok) {
			throw new Error("Failed to get user info");
		}

		const userData = await userResponse.json();

		// Store user session
		cookies.set("discord_user_id", userData.id, {
			path: "/",
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		});

		cookies.set("discord_username", userData.username, {
			path: "/",
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		});

		// Store avatar hash for profile image
		if (userData.avatar) {
			cookies.set("discord_avatar", userData.avatar, {
				path: "/",
				httpOnly: true,
				secure: true,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7,
			});
		}

		// Store global display name if available
		if (userData.global_name) {
			cookies.set("discord_global_name", userData.global_name, {
				path: "/",
				httpOnly: true,
				secure: true,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7,
			});
		}

		// Store discriminator for default avatar calculation
		cookies.set("discord_discriminator", userData.discriminator || "0", {
			path: "/",
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7,
		});

		// Handle bot installation flow
		if (flowData.flow === "install" && tokenData.guild) {
			// The token response includes guild info when bot scope is used
			// This confirms the bot was added successfully AFTER we got the token
			const guildInfo = {
				id: tokenData.guild.id,
				name: tokenData.guild.name,
				installedAt: new Date().toISOString(),
				installedBy: userData.id,
			};

			console.log("Bot installed to guild:", guildInfo);

			// TODO: Store guild installation info in database or KV storage
			// For now, we could store in a cookie or just redirect with success

			// Store tokens for this guild (for later API calls)
			// In production, store these securely in KV or database
			cookies.set("discord_access_token", tokenData.access_token, {
				path: "/",
				httpOnly: true,
				secure: true,
				sameSite: "lax",
				maxAge: tokenData.expires_in || 604800,
			});

			if (tokenData.refresh_token) {
				cookies.set("discord_refresh_token", tokenData.refresh_token, {
					path: "/",
					httpOnly: true,
					secure: true,
					sameSite: "lax",
					maxAge: 60 * 60 * 24 * 30, // 30 days
				});
			}

			// Redirect to admin with success message
			throw redirect(302, `/admin?installed=${tokenData.guild.id}`);
		}

		// Standard login flow - redirect to return URL or admin
		const returnTo = flowData.returnTo || "/admin";
		throw redirect(302, returnTo);
	} catch (error) {
		if (error?.status === 302) {
			throw error; // Re-throw redirects
		}
		console.error("Auth error:", error);
		throw redirect(302, "/login?error=auth_failed");
	}
}
