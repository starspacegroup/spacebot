import { execSync } from 'node:child_process';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Enables <script lang="ts"> in Svelte components (TS migration).
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		version: {
			// SvelteKit uses this to detect stale clients and force reload.
			// Changes on every deploy so cached JS/CSS can't persist across deploys.
			// Must be deterministic within a build: SvelteKit evaluates this config
			// several times per build (seconds apart), and a Date.now() here gave the
			// server and client bundles different version hashes — the SSR HTML then
			// defines __sveltekit_<A> while the client reads __sveltekit_<B>.env,
			// crashing all client JS at startup.
			// CF_PAGES_COMMIT_SHA covers Cloudflare CI builds; git covers local builds.
			name: (process.env.CF_PAGES_COMMIT_SHA || execSync('git rev-parse HEAD').toString())
				.trim()
				.slice(0, 7),
			// Poll every 60 seconds for version changes.
			// Essential when HMR is disabled (e.g. over the cloudflared tunnel)
			// so the client detects stale route manifests and forces a full reload.
			pollInterval: 60000,
		},
	},
};

export default config;
