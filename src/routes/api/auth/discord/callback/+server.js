import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { invalidateGuildCache } from "$lib/discord/guilds.js";
import { upsertUser } from "$lib/db/users.js";
import { notifySuperAdminsOfFirstLogin } from "$lib/server/superadmin-notifications.js";

/**
 * Safely get environment variable from platform.env (Cloudflare Workers/Pages)
 * @param {string} name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function getEnv(name, platform) {
	return platform?.env?.[name];
}

/**
 * Get the real origin when behind a proxy/tunnel (e.g., Cloudflare Tunnel)
 */
function getOrigin(request, url) {
	// Try x-forwarded-host first, then fall back to host header
	const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
	const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
	
	// Only use forwarded values if host looks like a real domain (not localhost without tunnel)
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
	const errorDescription = url.searchParams.get("error_description");

	// Handle user cancellation or errors from Discord
	if (error) {
		log.error("OAuth error from Discord:", error, errorDescription);
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

	const CLIENT_ID = getEnv('DISCORD_CLIENT_ID', platform);
	const CLIENT_SECRET = getEnv('DISCORD_CLIENT_SECRET', platform);
	const REDIRECT_URI = `${getOrigin(request, url)}/api/auth/discord/callback`;

	console.log('[OAuth Callback] REDIRECT_URI:', REDIRECT_URI);

	if (!CLIENT_ID || !CLIENT_SECRET) {
		throw redirect(302, "/login?error=config");
	}

	try {
		// Exchange code for access token
		// This is the critical step for OAuth2 Code Grant - we get the token
		// BEFORE the bot is added to the server (for install flow)
		console.log('[OAuth Callback] Exchanging code for token...');
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
			log.error("Token exchange failed:", errorData);
			console.log('[OAuth Callback] Token exchange failed:', errorData);
			throw new Error("Failed to get token");
		}

		const tokenData = await tokenResponse.json();
		console.log('[OAuth Callback] Token received, fetching user info...');

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
		console.log('[OAuth Callback] User info received:', userData.username);

		// Track user login in the database
		const db = platform?.env?.DB;
		if (db) {
			const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || "";
			const isSuperAdmin = adminUserIds.split(",").map(id => id.trim()).filter(Boolean).includes(userData.id);
			try {
				const upsertResult = await upsertUser(db, {
					id: userData.id,
					username: userData.username,
					global_name: userData.global_name || null,
					avatar: userData.avatar || null,
					discriminator: userData.discriminator || "0",
					email: userData.email || null,
					is_superadmin: isSuperAdmin,
				});

				if (upsertResult.success && upsertResult.isNewUser) {
					try {
						await notifySuperAdminsOfFirstLogin(platform, userData);
					} catch (notifyError) {
						log.error("[OAuth] Failed to send first-login DM notification:", notifyError);
					}
				}
			} catch (err) {
				log.error("[OAuth] Failed to track user login:", err);
			}
		}

		// Determine if we're on a secure connection (behind proxy/tunnel counts as secure)
		const isSecure = request.headers.get('x-forwarded-proto') === 'https' || url.protocol === 'https:';
		console.log('[OAuth Callback] isSecure:', isSecure);

		// Store full user object for pages that need it
		cookies.set(
			"discord_user",
			JSON.stringify({
				id: userData.id,
				username: userData.username,
				avatar: userData.avatar,
				global_name: userData.global_name,
				discriminator: userData.discriminator,
			}),
			{
				path: "/",
				httpOnly: true,
				secure: isSecure,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7, // 7 days
			},
		);

		// Store user session
		cookies.set("discord_user_id", userData.id, {
			path: "/",
			httpOnly: true,
			secure: isSecure,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		});

		cookies.set("discord_username", userData.username, {
			path: "/",
			httpOnly: true,
			secure: isSecure,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		});

		// Store avatar hash for profile image
		if (userData.avatar) {
			cookies.set("discord_avatar", userData.avatar, {
				path: "/",
				httpOnly: true,
				secure: isSecure,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7,
			});
		}

		// Store global display name if available
		if (userData.global_name) {
			cookies.set("discord_global_name", userData.global_name, {
				path: "/",
				httpOnly: true,
				secure: isSecure,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7,
			});
		}

		// Store discriminator for default avatar calculation
		cookies.set("discord_discriminator", userData.discriminator || "0", {
			path: "/",
			httpOnly: true,
			secure: isSecure,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7,
		});

		// Store access token for API calls (needed for fetching guilds)
		cookies.set("discord_access_token", tokenData.access_token, {
			path: "/",
			httpOnly: true,
			secure: isSecure,
			sameSite: "lax",
			maxAge: tokenData.expires_in || 604800,
		});

		if (tokenData.refresh_token) {
			cookies.set("discord_refresh_token", tokenData.refresh_token, {
				path: "/",
				httpOnly: true,
				secure: isSecure,
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 30, // 30 days
			});
		}

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

			log.debug("Bot installed to guild:", guildInfo);

			// Invalidate guild cache since bot membership changed
			invalidateGuildCache(cookies);

			// TODO: Store guild installation info in database or KV storage

			// Redirect to returnTo if set (e.g. upgrade flow), otherwise the installed server dashboard
			const installRedirect = flowData.returnTo && flowData.returnTo !== '/admin'
				? flowData.returnTo
				: `/admin/${tokenData.guild.id}`;
			throw redirect(302, installRedirect);
		}

		// Standard login flow - redirect to return URL or admin
		const returnTo = flowData.returnTo || "/admin";
		console.log('[OAuth Callback] Login complete, redirecting to:', returnTo);
		throw redirect(302, returnTo);
	} catch (error) {
		if (error?.status === 302) {
			throw error; // Re-throw redirects
		}
		log.error("Auth error:", error);
		throw redirect(302, "/login?error=auth_failed");
	}
}
