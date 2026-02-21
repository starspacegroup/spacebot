import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

/**
 * Vite plugin that fixes stale dep hash 504s when serving through cloudflared.
 *
 * Problem: Vite optimizes deps and tags them with a browser hash (?v=abc123).
 * When the hash changes (e.g. after a restart or re-optimization), browsers
 * with cached modules still request the OLD hash. Vite returns 504 for hash
 * mismatches, which breaks hydration entirely — no client-side JS works.
 *
 * Fix: Intercept requests for optimized dep files and strip the ?v= parameter
 * so Vite always serves the current version regardless of what hash the browser
 * is requesting. The browser will get the right content and on next navigation
 * SvelteKit's version check will force a full reload if needed.
 */
function staleDepsFix() {
	return {
		name: 'stale-deps-fix',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				// Only intercept requests for Vite's optimized deps
				if (req.url?.includes('/node_modules/.vite/deps/') && req.url.includes('?v=')) {
					// Strip the ?v= hash so Vite serves whatever version it currently has
					req.url = req.url.replace(/\?v=[a-f0-9]+/, '');
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [staleDepsFix(), sveltekit()],
	optimizeDeps: {
		// Pre-bundle Svelte runtime deps at startup so they're ready instantly.
		// Without this, Vite discovers and optimizes lazily on first request,
		// which causes 504 Gateway Timeouts through the cloudflared tunnel.
		include: [
			'svelte',
			'svelte/store',
			'svelte/transition',
			'svelte/animate',
			'svelte/easing',
			'svelte/internal/client',
			'svelte/internal/disclose-version',
			'svelte/internal/flags/legacy',
		],
	},
	server: {
		// Pre-transform client files at startup so they're served instantly.
		// Without this, the first page load triggers on-demand transforms that
		// can 504 through the cloudflared tunnel.
		warmup: {
			clientFiles: [
				'./src/routes/**/*.svelte',
				'./src/lib/components/**/*.svelte',
			],
		},
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
			'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
			'Pragma': 'no-cache',
			'Expires': '0',
		},
	},
});
