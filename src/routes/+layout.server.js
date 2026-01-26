/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    return {
      isLoggedIn: false,
      isAdmin: false,
      user: null,
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

  // Get user info from cookies
  const user = {
    id: userId,
    username: cookies.get("discord_username") || "User",
    avatar: cookies.get("discord_avatar") || null,
    globalName: cookies.get("discord_global_name") || null,
    discriminator: cookies.get("discord_discriminator") || "0",
  };

  return {
    isLoggedIn: true,
    isAdmin,
    user,
  };
}
