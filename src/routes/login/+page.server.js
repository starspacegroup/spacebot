// Only load dotenv in development (no-op on Cloudflare edge runtime)
if (process.env.NODE_ENV !== "production") {
  import("dotenv/config").catch(() => {});
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
  // Check if dev auth bypass is enabled
  const isDev = process.env.NODE_ENV !== "production";
  const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

  return {
    devAuthEnabled,
  };
}
