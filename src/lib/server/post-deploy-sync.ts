/**
 * After a deploy: wait until the new build is live, then sync every server's
 * slash commands at once instead of waiting for the minute sweep to work
 * through them ten at a time. Driven by scripts/sync-commands.ts, which the
 * deploy workflow runs on every push to main.
 *
 * Cloudflare Pages deploys from its own Git integration, so the workflow
 * cannot tell when the build is live. SvelteKit serves the build's version
 * (the first seven characters of the commit, see vite.config.js) at
 * /_app/version.json; the wait polls that.
 */

export interface PostDeployOptions {
	base: string;
	secret: string;
	sha?: string;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	log?: (line: string) => void;
	waitMs?: number;
	pollMs?: number;
	batch?: number;
	maxRounds?: number;
}

const defaults = {
	waitMs: 20 * 60_000,
	pollMs: 15_000,
	batch: 50,
	maxRounds: 20,
};

/** True once the live build is the commit `sha` (compared on 7 characters). */
export async function waitForVersion(opts: PostDeployOptions): Promise<boolean> {
	const f = opts.fetch ?? fetch;
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const want = String(opts.sha ?? '').slice(0, 7);
	if (!want) return true;
	const waitMs = opts.waitMs ?? defaults.waitMs;
	const pollMs = opts.pollMs ?? defaults.pollMs;
	for (let waited = 0; waited <= waitMs; waited += pollMs) {
		try {
			const res = await f(`${opts.base}/_app/version.json`, { cache: 'no-store' } as any);
			if (res.ok) {
				const { version } = (await res.json()) as { version?: string };
				if (String(version ?? '').slice(0, 7) === want) return true;
				opts.log?.(`live build is ${version}, waiting for ${want}`);
			}
		} catch (error: any) {
			opts.log?.(`version check failed: ${error?.message ?? error}`);
		}
		if (waited + pollMs <= waitMs) await sleep(pollMs);
	}
	return false;
}

/**
 * Run the sync_commands job in rounds until a round changes nothing. The
 * sweep takes the servers looked at longest ago first, so the rounds walk
 * every server once before coming back to a synced one.
 */
export async function syncAllGuilds(opts: PostDeployOptions) {
	const f = opts.fetch ?? fetch;
	const batch = opts.batch ?? defaults.batch;
	const maxRounds = opts.maxRounds ?? defaults.maxRounds;
	const total = { rounds: 0, checked: 0, synced: 0, failed: 0 };
	for (let round = 0; round < maxRounds; round++) {
		const res = await f(`${opts.base}/api/cron`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.secret}` },
			body: JSON.stringify({ jobName: 'sync_commands', limit: batch }),
		});
		const body: any = await res.json().catch(() => ({}));
		if (!res.ok)
			throw new Error(`sync_commands: HTTP ${res.status} ${body?.error ?? ''}`.trim());
		const r = body?.result ?? body;
		total.rounds++;
		total.checked += r.checked ?? 0;
		total.synced += r.synced ?? 0;
		total.failed += r.failed ?? 0;
		opts.log?.(`round ${round + 1}: ${JSON.stringify(r)}`);
		if (!r.synced && !r.failed) break;
		if ((r.checked ?? 0) < batch && !r.failed) break;
	}
	return total;
}
