import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { listUsers } from "$lib/db/users.js";

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	const db = (platform as any)?.env?.DB;

	const search = url.searchParams.get("search") || undefined;
	const page = parseInt(url.searchParams.get("page") || "1", 10);
	const limit = 50;
	const offset = (page - 1) * limit;

	const result = db
		? await listUsers(db, { search, limit, offset, sort: "last_login_at", order: "desc" })
		: { users: [], total: 0 };

	return {
		users: result.users,
		total: result.total,
		page,
		limit,
		search: search || "",
	};
}
