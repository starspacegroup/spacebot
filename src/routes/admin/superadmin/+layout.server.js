import { redirect } from "@sveltejs/kit";

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	return {
		isSuperAdmin: true,
	};
}
