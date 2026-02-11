import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		version: {
			// SvelteKit uses this to detect stale clients and force reload.
			// Changes on every build so cached JS/CSS can't persist across deploys.
			name: Date.now().toString()
		}
	}
};

export default config;
