import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ecosystem = require('../../ecosystem.config.cjs');

/**
 * These scripts are TypeScript and import siblings with TS-style `.js`
 * specifiers. Node's type stripping runs the file but does not rewrite `.js`
 * to `.ts`, so the first `../src/lib/*.js` import throws ERR_MODULE_NOT_FOUND.
 *
 * The failure is quiet in the worst way: PM2's fork container survives the
 * throw, so `pm2 list` keeps reporting the app `online` while it does nothing.
 * That is how the auto-deploy poller sat dead for weeks with the box 24 commits
 * behind main and every process looking healthy.
 */
describe('PM2 ecosystem interpreters', () => {
	const apps = ecosystem.apps as Array<Record<string, any>>;

	it('runs every TypeScript entry point with bun', () => {
		const wrong = apps
			.filter((app) => typeof app.script === 'string' && app.script.endsWith('.ts'))
			.filter((app) => app.interpreter !== 'bun')
			.map((app) => `${app.name} (${app.interpreter || 'default'})`);

		expect(wrong).toEqual([]);
	});

	it('keeps the four production processes defined', () => {
		expect(apps.map((app) => app.name).sort()).toEqual([
			'spacebot-cron',
			'spacebot-deploy',
			'spacebot-gateway',
			'spacebot-tunnel',
		]);
	});

	it('does not pass Node-only flags that current Node has removed', () => {
		for (const app of apps) {
			expect(String(app.args ?? '')).not.toContain('--experimental-specifier-resolution');
		}
	});
});
