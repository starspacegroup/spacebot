import { redirect } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
	const params = new URLSearchParams();
	params.set("flow", "install");

	// Forward any query params (guild_id, permissions, return_to)
	for (const [key, value] of url.searchParams) {
		params.set(key, value);
	}

	throw redirect(302, `/api/auth/discord?${params}`);
}
