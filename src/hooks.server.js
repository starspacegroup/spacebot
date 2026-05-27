import { json, redirect } from "@sveltejs/kit";
import { log } from "$lib/log.js";
import { upsertUser } from "$lib/db/users.js";
import { trackUserActivity } from "$lib/db/user-activity.js";
import { handleGatewayLogsApi } from "$lib/server/gateway-logs-api.js";

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

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
}

function shouldTrackPath(pathname) {
  if (!pathname || pathname.startsWith("/_app/") || pathname.startsWith("/_functions/")) {
    return false;
  }

  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest"
  ) {
    return false;
  }

  return !/\.(?:css|js|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|json)$/i.test(pathname);
}

function classifyActivityType(pathname, method) {
  if (pathname.startsWith("/api/")) return "api_action";
  if (method === "GET") return "page_view";
  return "action";
}

function sanitizeQueryString(searchParams) {
  if (!searchParams || typeof searchParams.entries !== "function") return "";

  const redactedKeys = new Set([
    "code",
    "state",
    "token",
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "api_key",
    "key",
  ]);

  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (redactedKeys.has(String(key).toLowerCase())) {
      next.set(key, "[redacted]");
    } else {
      next.set(key, value);
    }
  }

  return next.toString();
}

function getRequestIp(event) {
  const cfIp = event.request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwarded = event.request.headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const [first] = forwarded.split(",");
  return first?.trim() || null;
}

async function trackAuthenticatedRequestActivity(event, statusCode, details = null) {
  const userId = event.cookies.get("discord_user_id");
  if (!userId) return;

  const db = event.platform?.env?.DB;
  if (!db) return;

  const pathname = event.url.pathname;
  if (!shouldTrackPath(pathname)) return;

  const method = String(event.request.method || "GET").toUpperCase();
  const queryString = sanitizeQueryString(event.url.searchParams);

  await trackUserActivity(db, {
    userId,
    activityType: classifyActivityType(pathname, method),
    method,
    path: pathname,
    queryString: queryString || null,
    statusCode,
    referrer: event.request.headers.get("referer") || null,
    ipAddress: getRequestIp(event),
    userAgent: event.request.headers.get("user-agent") || null,
    details,
  });
}

/**
 * Get dev user configuration from environment
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function getDevUser(platform) {
  // Use DEV_USER_ID if set, otherwise fall back to first admin user
  const devUserId = getEnv('DEV_USER_ID', platform) ||
    (getEnv('ADMIN_USER_IDS', platform)?.split(",")[0]?.trim()) ||
    "000000000000000000";

  log.debug("[DevAuth] Using dev user ID:", devUserId);

  return {
    id: devUserId,
    username: getEnv('DEV_USERNAME', platform) || "DevUser",
    globalName: getEnv('DEV_GLOBAL_NAME', platform) || "Development User",
    avatar: getEnv('DEV_AVATAR', platform) || null,
    discriminator: "0",
  };
}

/**
 * Set dev auth cookies
 * @param {import('@sveltejs/kit').Cookies} cookies
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform
 */
function setDevAuthCookies(cookies, platform) {
  const devUser = getDevUser(platform);
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

  log.debug(
    "[DevAuth] Set dev auth cookies for user:",
    devUser.username,
    `(${devUser.id})`,
  );
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const { url, cookies, platform } = event;

  try {
    // Check if dev auth bypass is enabled
    const isDev = getEnv('NODE_ENV', platform) !== 'production';
    const devAuthEnabled = isDev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

    // Handle dev auth bypass
    if (devAuthEnabled) {
      // Special /dev-login route for easy dev authentication
      if (url.pathname === "/dev-login") {
        const devUser = getDevUser(platform);
        setDevAuthCookies(cookies, platform);

        // Track dev user in the database so they appear in User Management
        const db = platform?.env?.DB;
        if (db) {
          const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || "";
          const isSuperAdmin = adminUserIds.split(",").map(id => id.trim()).filter(Boolean).includes(devUser.id);
          try {
            await upsertUser(db, {
              id: devUser.id,
              username: devUser.username,
              global_name: devUser.globalName || null,
              avatar: devUser.avatar || null,
              discriminator: devUser.discriminator || "0",
              is_superadmin: isSuperAdmin,
            });
          } catch (err) {
            log.error("[DevAuth] Failed to track dev user login:", err);
          }
        }

        const returnTo = url.searchParams.get("return_to") || "/admin";
        // Use SvelteKit's redirect to ensure cookies are properly sent
        throw redirect(302, returnTo);
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

        log.debug("[DevAuth] Cleared dev auth cookies");
        throw redirect(302, "/");
      }

      // Allow ?dev_auth=true query param to auto-login
      if (url.searchParams.get("dev_auth") === "true") {
        const userId = cookies.get("discord_user_id");
        if (!userId) {
          const devUser = getDevUser(platform);
          setDevAuthCookies(cookies, platform);

          // Track dev user in the database
          const db = platform?.env?.DB;
          if (db) {
            const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || "";
            const isSuperAdmin = adminUserIds.split(",").map(id => id.trim()).filter(Boolean).includes(devUser.id);
            try {
              await upsertUser(db, {
                id: devUser.id,
                username: devUser.username,
                global_name: devUser.globalName || null,
                avatar: devUser.avatar || null,
                discriminator: devUser.discriminator || "0",
                is_superadmin: isSuperAdmin,
              });
            } catch (err) {
              log.error("[DevAuth] Failed to track dev user login:", err);
            }
          }

          // Remove the dev_auth param and redirect
          const cleanUrl = new URL(url);
          cleanUrl.searchParams.delete("dev_auth");
          throw redirect(302, cleanUrl.pathname + cleanUrl.search);
        }
      }
    }

    // Add dev auth status to event.locals for use in routes
    event.locals.devAuthEnabled = devAuthEnabled;

    if (url.pathname === "/api/gateway/logs") {
      const response = await handleGatewayLogsApi(event);
      await trackAuthenticatedRequestActivity(event, response?.status || 200);
      return response;
    }

    const response = await resolve(event);

    // Add cache headers for dynamic content to ensure fresh data
    // Assets in /_app/ are already hashed and can be cached long-term
    // /api/ routes manage their own cache headers
    // All other routes (HTML pages + SvelteKit __data.json fetches) must not be cached
    if (!url.pathname.startsWith('/_app/') && !url.pathname.startsWith('/api/')) {
      response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
    }

    await trackAuthenticatedRequestActivity(event, response?.status || 200);

    return response;
  } catch (error) {
    const isRedirect = Boolean(
      error &&
      typeof error === "object" &&
      typeof error.status === "number" &&
      error.status >= 300 &&
      error.status < 400 &&
      typeof error.location === "string",
    );

    if (isRedirect) {
      throw error;
    }

    log.error("[Hooks] Unhandled request error", {
      method: event.request.method,
      path: url.pathname,
      search: url.search,
      cfRay: event.request.headers.get("cf-ray") || null,
      error: error?.stack || error?.message || String(error),
    });

    if (url.pathname.startsWith('/api/')) {
      await trackAuthenticatedRequestActivity(event, 500, { internalError: true });
      return json({ error: "Internal server error" }, { status: 500 });
    }

    await trackAuthenticatedRequestActivity(event, 500, { internalError: true });
    return new Response("Internal server error", {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}
