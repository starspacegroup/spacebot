import "dotenv/config";

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
  // Check if dev auth bypass is enabled
  const isDev = process.env.NODE_ENV !== "production";
  const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

  return {
    devAuthEnabled,
  };
}
