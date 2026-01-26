/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");
  const username = cookies.get("discord_username");
  const avatar = cookies.get("discord_avatar");

  // Get the Discord client ID for the bot invite link
  const clientId = platform?.env?.DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID;

  // Bot permissions we need:
  // - View Channels
  // - Send Messages
  // - Read Message History
  // - Manage Messages (for moderation)
  // - Kick Members
  // - Ban Members
  // - View Audit Log
  const permissions = 1099511693334;

  // Build the invite URL
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`
    : null;

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
