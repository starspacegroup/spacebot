import { describe, expect, it } from 'vitest';
import { runLimited } from '../lib/server/run-limited.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('runLimited', () => {
	it('returns results in input order', async () => {
		const out = await runLimited(
			[1, 2, 3, 4, 5].map((n) => async () => n * 2),
			2
		);
		expect(out).toEqual([2, 4, 6, 8, 10]);
	});

	it('never has more than the limit in flight', async () => {
		let now = 0;
		let peak = 0;
		const job = async () => {
			now++;
			peak = Math.max(peak, now);
			await tick();
			now--;
		};
		await runLimited(
			Array.from({ length: 10 }, () => job),
			3
		);
		expect(peak).toBe(3);
	});

	it('stops starting new jobs once aborted', async () => {
		const controller = new AbortController();
		let started = 0;
		const jobs = Array.from({ length: 6 }, () => async () => {
			started++;
			controller.abort();
			await tick();
		});
		await expect(runLimited(jobs, 1, controller.signal)).rejects.toThrow('aborted');
		expect(started).toBe(1);
	});

	it('handles an empty list', async () => {
		expect(await runLimited([], 3)).toEqual([]);
	});
});
