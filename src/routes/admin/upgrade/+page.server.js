import { redirect } from "@sveltejs/kit";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, parent, url }) {
	const userId = cookies.get("discord_user_id");

	if (!userId) {
		// Not logged in — redirect to login with return_to back here
		const returnTo = `/admin/upgrade?interval=${url.searchParams.get("interval") || "monthly"}`;
		throw redirect(302, `/login?return_to=${encodeURIComponent(returnTo)}`);
	}

	const parentData = await parent();
	const adminGuilds = parentData.adminGuilds || [];

	return {
		adminGuilds,
		interval: url.searchParams.get("interval") || "monthly",
	};
}
