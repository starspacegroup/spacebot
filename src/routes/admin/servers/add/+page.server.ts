/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");
  const username = cookies.get("discord_username");
  const avatar = cookies.get("discord_avatar");

  // Use the OAuth2 code grant flow for bot installation
  // This ensures proper authorization before the bot joins the server
  // Direct Discord URLs won't work when "Require OAuth2 Code Grant" is enabled
  const inviteUrl = "/api/auth/discord?flow=install";

  return {
    user: userId
      ? {
        id: userId,
        username: username || "Unknown",
        avatar,
      }
      : null,
    inviteUrl,
  };
}
