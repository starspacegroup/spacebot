/**
 * Cloudflare Pages applies one build command — `bun run db:migrate && bun run
 * build` — to every environment, so a preview build of ANY branch runs the
 * migration script, and `--remote` points at the same production D1 that main
 * migrates. Preview builds of open PRs were therefore attempting to apply
 * unmerged migrations to the live database; the only thing stopping them was
 * the preview environment's API token lacking D1 write access.
 *
 * That is luck, not a guard. This is the guard: on a preview branch the script
 * must exit before it resolves the Wrangler CLI, let alone opens a connection.
 */
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/migrate.ts');

/** Run the migration script with Pages-style env, capturing what it printed. */
function runMigrate(env: Record<string, string>) {
	return spawnSync('bun', [scriptPath], {
		env: { ...process.env, ...env },
		encoding: 'utf8',
		timeout: 60_000,
	});
}

describe('migrate.ts preview guard', () => {
	const previewBranches = [
		'dependabot/bun/marked-18.0.10',
		'fix/gateway-test-worker-exit',
		'dev',
	];

	it.each(previewBranches)('skips remote migrations on preview branch %s', (branch) => {
		const result = runMigrate({ CF_PAGES_BRANCH: branch });

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('skipping remote migrations');
		expect(result.stdout).toContain(branch);
	});

	it('exits before it ever resolves the Wrangler CLI', () => {
		const result = runMigrate({ CF_PAGES_BRANCH: 'some-open-pr' });

		// These two lines are printed by the migration path itself. Seeing either
		// one means the guard let a preview build through to the database.
		expect(result.stdout).not.toContain('Using Wrangler command');
		expect(result.stdout).not.toContain('Running migrations');
	});

	it('honours a project whose production branch is not main', () => {
		const result = runMigrate({
			CF_PAGES_BRANCH: 'main',
			PAGES_PRODUCTION_BRANCH: 'release',
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('skipping remote migrations');
		expect(result.stdout).toContain('release');
	});
});
