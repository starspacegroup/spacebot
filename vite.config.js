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
	},
});
