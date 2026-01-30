import "dotenv/config";
import { redirect } from "@sveltejs/kit";

/**
 * Dev Auth Bypass
 *
 * In development mode, allows bypassing Discord OAuth by:
 * 1. Setting DEV_AUTH_BYPASS=true in .env
 * 2. Visiting /dev-login to instantly log in as a dev user
 * 3. Or adding ?dev_auth=true to any URL
 *
 * The dev user will have the user ID from DEV_USER_ID env var
 * (defaults to the first ADMIN_USER_IDS if set, or a placeholder)
 */

const isDev = process.env.NODE_ENV !== "production";
const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

console.log("[DevAuth] isDev:", isDev, "devAuthEnabled:", devAuthEnabled);
console.log("[DevAuth] ADMIN_USER_IDS:", process.env.ADMIN_USER_IDS);

/**
 * Get dev user configuration from environment
 */
function getDevUser() {
  // Use DEV_USER_ID if set, otherwise fall back to first admin user
  const devUserId = process.env.DEV_USER_ID ||
    (process.env.ADMIN_USER_IDS?.split(",")[0]?.trim()) ||
    "000000000000000000";

  console.log("[DevAuth] Using dev user ID:", devUserId);

  return {
    id: devUserId,
    username: process.env.DEV_USERNAME || "DevUser",
    globalName: process.env.DEV_GLOBAL_NAME || "Development User",
    avatar: process.env.DEV_AVATAR || null,
    discriminator: "0",
  };
}

/**
 * Set dev auth cookies
 */
function setDevAuthCookies(cookies) {
  const devUser = getDevUser();
  const cookieOptions = {
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  };

  cookies.set("discord_user_id", devUser.id, cookieOptions);
  cookies.set("discord_username", devUser.username, cookieOptions);
  cookies.set("discord_global_name", devUser.globalName, cookieOptions);
  if (devUser.avatar) {
    cookies.set("discord_avatar", devUser.avatar, cookieOptions);
  }
  cookies.set("discord_discriminator", devUser.discriminator, cookieOptions);

  // Set a mock access token for API calls
  cookies.set("discord_access_token", "dev_mock_token", cookieOptions);

  console.log(
    "[DevAuth] Set dev auth cookies for user:",
    devUser.username,
    `(${devUser.id})`,
  );
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const { url, cookies } = event;

  // Handle dev auth bypass
  if (devAuthEnabled) {
    // Special /dev-login route for easy dev authentication
    if (url.pathname === "/dev-login") {
      setDevAuthCookies(cookies);
      const returnTo = url.searchParams.get("return_to") || "/admin";
      // Use SvelteKit's redirect to ensure cookies are properly sent
      redirect(302, returnTo);
    }

    // Special /dev-logout route to clear dev auth
    if (url.pathname === "/dev-logout") {
      const cookieOptions = { path: "/" };
      cookies.delete("discord_user_id", cookieOptions);
      cookies.delete("discord_username", cookieOptions);
      cookies.delete("discord_global_name", cookieOptions);
      cookies.delete("discord_avatar", cookieOptions);
      cookies.delete("discord_discriminator", cookieOptions);
      cookies.delete("discord_access_token", cookieOptions);

      console.log("[DevAuth] Cleared dev auth cookies");
      redirect(302, "/");
    }

    // Allow ?dev_auth=true query param to auto-login
    if (url.searchParams.get("dev_auth") === "true") {
      const userId = cookies.get("discord_user_id");
      if (!userId) {
        setDevAuthCookies(cookies);
        // Remove the dev_auth param and redirect
        const cleanUrl = new URL(url);
        cleanUrl.searchParams.delete("dev_auth");
        redirect(302, cleanUrl.pathname + cleanUrl.search);
      }
    }
  }

  // Add dev auth status to event.locals for use in routes
  event.locals.devAuthEnabled = devAuthEnabled;

  return resolve(event);
}
