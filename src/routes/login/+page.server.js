/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    return {
      isLoggedIn: false,
      isAdmin: false,
    };
  }

  // Get ADMIN_USER_IDS from environment
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  // Parse comma-separated list of admin IDs
  const adminIdList = adminUserIds.split(",").map((id) => id.trim()).filter(
    Boolean,
  );

  // Check if current user is an admin
  const isAdmin = adminIdList.includes(userId);

  return {
    isLoggedIn: true,
    isAdmin,
  };
}
