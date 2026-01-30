import { redirect } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies }) {
  // Clear all auth-related cookies
  cookies.delete("discord_user", { path: "/" });
  cookies.delete("discord_user_id", { path: "/" });
  cookies.delete("discord_username", { path: "/" });
  cookies.delete("discord_avatar", { path: "/" });
  cookies.delete("discord_global_name", { path: "/" });
  cookies.delete("discord_discriminator", { path: "/" });
  cookies.delete("discord_access_token", { path: "/" });
  cookies.delete("discord_refresh_token", { path: "/" });

  // Redirect to home page
  throw redirect(302, "/");
}
