import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		version: {
			// SvelteKit uses this to detect stale clients and force reload.
			// Changes on every build so cached JS/CSS can't persist across deploys.
			name: Date.now().toString(),
			// Poll every 60 seconds for version changes.
			// Essential when HMR is disabled (e.g. over the cloudflared tunnel)
			// so the client detects stale route manifests and forces a full reload.
			pollInterval: 60000
		}
	}
};

export default config;
