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

	/**
	 * PM2's Bun fork container `require()`s the entry file, and Bun refuses to
	 * require() a module with top-level await:
	 *
	 *   TypeError: require() async module "..." is unsupported.
	 *
	 * The process then crash-loops before printing a single line of its own, so
	 * the symptom is a restart counter and an empty log. Wrap startup in a
	 * `main()` and call it at the bottom, the way scripts/cron.ts does.
	 */
	it('has no top-level await in any entry point', async () => {
		const { readFile } = await import('node:fs/promises');

		for (const app of apps) {
			if (typeof app.script !== 'string' || !app.script.endsWith('.ts')) continue;

			const source = await readFile(new URL(`../../${app.script}`, import.meta.url), 'utf8');
			const offending = source
				.split('\n')
				// Top level means column zero: anything indented is inside something.
				.filter((line) => /^(await |(const|let|var)\s+[^=]+=\s*await )/.test(line));

			expect({ app: app.name, offending }).toEqual({ app: app.name, offending: [] });
		}
	});

	it('does not pass Node-only flags that current Node has removed', () => {
		for (const app of apps) {
			expect(String(app.args ?? '')).not.toContain('--experimental-specifier-resolution');
		}
	});
});
