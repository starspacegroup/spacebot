import { redirect } from "@sveltejs/kit";
import { isAIEnabled } from "$lib/ai/chat.js";

/**
 * Safely get environment variable
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, params, parent }) {
  const parentData = await parent();

  const userId = cookies.get("discord_user_id");
  if (!userId) {
    throw redirect(302, "/login");
  }

  if (!parentData.isSuperAdmin) {
    throw redirect(302, `/admin/${params.serverId}`);
  }

  const env = {
    CLOUDFLARE_ACCOUNT_ID: getEnv("CLOUDFLARE_ACCOUNT_ID", platform),
    CLOUDFLARE_AI_TOKEN: getEnv("CLOUDFLARE_AI_TOKEN", platform),
  };

  const aiEnabled = isAIEnabled(env);

  // Get guild info from parent data
  const guild = parentData.adminGuilds?.find(g => g.id === params.serverId) || null;

  return {
    serverId: params.serverId,
    aiEnabled,
    guild,
    user: {
      id: userId,
      username: cookies.get("discord_username") || "User",
      avatar: cookies.get("discord_avatar") || null,
      globalName: cookies.get("discord_global_name") || null,
    },
  };
}
