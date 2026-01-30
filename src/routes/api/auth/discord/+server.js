import { redirect } from "@sveltejs/kit";

/**
 * Discord OAuth2 Authorization Endpoint
 *
 * Supports two flows:
 * 1. User login: ?flow=login (default) - Gets user identity and guild list
 * 2. Bot installation with OAuth2 Code Grant: ?flow=install - Adds bot AND gets token
 *    This ensures the application receives a token before the bot joins the server.
 *
 * Query parameters:
 * - flow: 'login' | 'install' (default: 'login')
 * - guild_id: Pre-select a specific guild for bot installation
 * - permissions: Bot permissions bitfield (default: configured permissions)
 */

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, cookies, platform }) {
	const CLIENT_ID = platform?.env?.DISCORD_CLIENT_ID ||
		process.env.DISCORD_CLIENT_ID;
	const REDIRECT_URI = `${url.origin}/api/auth/discord/callback`;

	if (!CLIENT_ID) {
		throw new Error("DISCORD_CLIENT_ID not configured");
	}

	// Determine the OAuth2 flow type
	const flow = url.searchParams.get("flow") || "login";
	const guildId = url.searchParams.get("guild_id");
	const customPermissions = url.searchParams.get("permissions");

	// Default bot permissions (Administrator for now, configure as needed)
	// See: https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
	const DEFAULT_BOT_PERMISSIONS = "8"; // Administrator

	// Generate a state parameter for CSRF protection
	const state = crypto.randomUUID();
	cookies.set("oauth_state", state, {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		maxAge: 60 * 10, // 10 minutes
	});

	// Store the flow type in the state for the callback
	const stateData = JSON.stringify({
		flow,
		returnTo: url.searchParams.get("return_to") || "/",
	});
	cookies.set("oauth_flow", stateData, {
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
	});

	if (flow === "install") {
		// OAuth2 Code Grant flow with bot installation
		// This requires the full OAuth2 flow, ensuring the app gets a token
		// BEFORE the bot is added to the server
		params.set("scope", "identify guilds bot applications.commands");
		params.set("permissions", customPermissions || DEFAULT_BOT_PERMISSIONS);

		// Optionally pre-select a guild
		if (guildId) {
			params.set("guild_id", guildId);
			// Disable guild selection if a specific guild is provided
			params.set("disable_guild_select", "true");
		}
	} else {
		// Standard login flow - just get user info
		params.set("scope", "identify guilds");
	}

	throw redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
}
