import { getGuildTimezone } from "$lib/db/settings.js";

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ platform, params, cookies }) {
  const db = platform?.env?.DB;
  const serverId = params.serverId;

  // Load the server's configured timezone override (or null for browser auto-detect)
  const serverTimezone = db ? await getGuildTimezone(db, serverId) : null;

  // Prefer the viewing user's browser timezone (set via cookie in +layout.svelte)
  // so that stats, logs, and charts are displayed relative to the viewer.
  // Falls back to the server-configured timezone, then null (UTC on the server).
  const userTimezone = cookies.get("user_timezone") || null;
  const timezone = userTimezone || serverTimezone || null;

  return {
    timezone,
    serverTimezone,
  };
}
