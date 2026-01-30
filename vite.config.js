import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 4269,
		allowedHosts: ["spacebot-dev.starspace.group"],
	},
});
