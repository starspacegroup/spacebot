/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ locals, platform }) {
  // Check if dev auth bypass is enabled
  const isDev = getEnv('NODE_ENV', platform) !== 'production';
  const devAuthEnabled = isDev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

  return {
    devAuthEnabled,
  };
}
