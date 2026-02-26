import { getGuildTimezone } from "$lib/db/settings.js";

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ platform, params }) {
  const db = platform?.env?.DB;
  const serverId = params.serverId;

  // Load the server's timezone override (or null for browser auto-detect)
  const timezone = db ? await getGuildTimezone(db, serverId) : null;

  return {
    timezone,
  };
}
