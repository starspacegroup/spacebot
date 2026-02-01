import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 4269,
		host: true, // Listen on all interfaces for tunnel access
		allowedHosts: ["spacebot-dev.starspace.group", "localhost"],
		// Improve HMR over tunnel
		hmr: {
			clientPort: 443, // Tunnel uses HTTPS
			protocol: 'wss',
			host: 'spacebot-dev.starspace.group',
		},
	},
});
