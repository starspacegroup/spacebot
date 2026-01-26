/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    return {
      isLoggedIn: false,
      isAdmin: false,
      isSuperAdmin: false,
      user: null,
    };
  }

  // Get ADMIN_USER_IDS from environment (these are superadmins with full access)
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  // Parse comma-separated list of superadmin IDs
  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(
      Boolean,
    );

  // Check if current user is a superadmin (defined in ADMIN_USER_IDS)
  const isSuperAdmin = superAdminIdList.includes(userId);

  // Get user info from cookies
  const user = {
    id: userId,
    username: cookies.get("discord_username") || "User",
    avatar: cookies.get("discord_avatar") || null,
    globalName: cookies.get("discord_global_name") || null,
    discriminator: cookies.get("discord_discriminator") || "0",
  };

  // Note: isAdmin will be determined per-page based on guild permissions
  // For layout purposes, we consider superadmins as always having admin access
  // Regular users will have their admin status determined by the admin page
  return {
    isLoggedIn: true,
    isAdmin: isSuperAdmin, // For backward compatibility in layout/nav
    isSuperAdmin,
    user,
  };
}
