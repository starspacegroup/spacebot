import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 4269,
		host: true, // Listen on all interfaces for tunnel access
		allowedHosts: ["spacebot-dev.starspace.group", "localhost"],
		// Disable HMR completely to prevent WebSocket connection issues over tunnels
		// This prevents the site from hanging when the HMR WebSocket fails to connect
		// For local development, you can set VITE_HMR=true to re-enable HMR
		hmr: process.env.VITE_HMR === 'true' ? {
			timeout: 5000,
		} : false,
		// Prevent browsers from caching modules and CSS with 304 responses.
		// Without HMR the only way to pick up changes is a full reload,
		// so stale 304s cause "flash then revert" styling bugs.
		headers: {
			'Cache-Control': 'no-store, max-age=0',
		},
	},
});
