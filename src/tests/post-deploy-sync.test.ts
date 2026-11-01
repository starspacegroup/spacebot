import { describe, expect, it } from 'vitest';
import { syncAllGuilds, waitForVersion } from '../lib/server/post-deploy-sync.js';

const sleep = async () => {};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

describe('waitForVersion', () => {
	it('returns at once with no sha', async () => {
		expect(await waitForVersion({ base: 'b', secret: 's' })).toBe(true);
	});

	it('polls until the live build is the commit', async () => {
		const seen = ['0000000', null, 'abcdef1'];
		const lines: string[] = [];
		let i = 0;
		const f: any = async (url: string) => {
			expect(url).toBe('https://x/_app/version.json');
			const v = seen[i++];
			if (v === null) throw new Error('down');
			return json({ version: v });
		};
		expect(
			await waitForVersion({
				base: 'https://x',
				secret: 's',
				sha: 'abcdef1234',
				fetch: f,
				sleep,
				log: (l) => lines.push(l),
				pollMs: 1,
				waitMs: 10,
			})
		).toBe(true);
		expect(lines).toEqual([
			'live build is 0000000, waiting for abcdef1',
			'version check failed: down',
		]);
	});

	it('gives up after the wait, ignoring non-OK answers', async () => {
		const f: any = async () => new Response('', { status: 503 });
		expect(
			await waitForVersion({
				base: 'b',
				secret: 's',
				sha: 'abc',
				fetch: f,
				sleep,
				pollMs: 5,
				waitMs: 10,
			})
		).toBe(false);
	});
});

describe('syncAllGuilds', () => {
	it('runs rounds until one changes nothing, with the bearer secret', async () => {
		const rounds = [
			{ checked: 2, synced: 2, failed: 0 },
			{ checked: 2, synced: 1, failed: 0 },
			{ checked: 2, synced: 0, failed: 0 },
		];
		const bodies: any[] = [];
		const f: any = async (url: string, init: any) => {
			expect(url).toBe('b/api/cron');
			expect(init.headers.Authorization).toBe('Bearer s');
			bodies.push(JSON.parse(init.body));
			return json({ success: true, result: rounds.shift() });
		};
		const total = await syncAllGuilds({
			base: 'b',
			secret: 's',
			fetch: f,
			batch: 2,
			log: () => {},
		});
		expect(total).toEqual({ rounds: 3, checked: 6, synced: 3, failed: 0 });
		expect(bodies[0]).toEqual({ jobName: 'sync_commands', limit: 2 });
	});

	it('stops on a short batch, and at maxRounds while failing', async () => {
		const short: any = async () => json({ result: { checked: 1, synced: 1 } });
		expect(
			await syncAllGuilds({ base: 'b', secret: 's', fetch: short, batch: 5 })
		).toMatchObject({
			rounds: 1,
			synced: 1,
		});
		const failing: any = async () => json({ result: { checked: 1, failed: 1 } });
		expect(
			await syncAllGuilds({ base: 'b', secret: 's', fetch: failing, batch: 5, maxRounds: 3 })
		).toMatchObject({ rounds: 3, failed: 3 });
		const empty: any = async () => json({});
		expect(await syncAllGuilds({ base: 'b', secret: 's', fetch: empty })).toMatchObject({
			rounds: 1,
			checked: 0,
		});
	});

	it('throws on an HTTP error', async () => {
		const f: any = async () => json({ error: 'Unauthorized' }, 403);
		await expect(syncAllGuilds({ base: 'b', secret: 's', fetch: f })).rejects.toThrow(
			'sync_commands: HTTP 403 Unauthorized'
		);
		const g: any = async () => new Response('nope', { status: 500 });
		await expect(syncAllGuilds({ base: 'b', secret: 's', fetch: g })).rejects.toThrow(
			'HTTP 500'
		);
	});
});
