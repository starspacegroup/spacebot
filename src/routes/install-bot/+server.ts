import { redirect } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export function GET({ url, cookies }) {
	const isLoggedIn = !!cookies.get("discord_user_id");

	if (!isLoggedIn) {
		// Build the return URL back to this install-bot route with all original params
		const returnTo = `/install-bot${url.search}`;
		const loginParams = new URLSearchParams();
		loginParams.set("flow", "login");
		loginParams.set("return_to", returnTo);
		throw redirect(302, `/api/auth/discord?${loginParams}`);
	}

	const params = new URLSearchParams();
	params.set("flow", "install");

	// Forward any query params (guild_id, permissions, return_to)
	for (const [key, value] of url.searchParams) {
		params.set(key, value);
	}

	throw redirect(302, `/api/auth/discord?${params}`);
}
