import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config for SpaceBot.
 *
 * The dev server is externally managed (always running on :4269, per the
 * project convention — see CLAUDE.md). We deliberately do NOT define a
 * `webServer` block so Playwright never starts/stops a server; it simply
 * drives the already-running instance at `baseURL`.
 *
 * Browsers are not installed in CI here — this is a scaffold. Run locally
 * with `bunx playwright install` first, then `bun run test:e2e`.
 */
const PORT = Number(process.env.PORT ?? 4269);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	// `.e2e.ts` suffix (not `.spec.ts`) so vitest's default glob doesn't
	// try to run these Playwright tests in the unit-test runner.
	testMatch: '**/*.e2e.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
