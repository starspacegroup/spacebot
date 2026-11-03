import { describe, expect, it, vi } from 'vitest';

/**
 * The account list routes read `?limit=` and `?offset=` with a bare `Number()`,
 * so `?limit=1.5` reached SQL as a fraction (SQLite refuses it) and a huge
 * offset went through unbounded. They now go through `intParam`.
 */

const { aiJobs, workflows, runnerJobs, runnerEvents, runnerInstances } = vi.hoisted(() => {
	const make = () => vi.fn(async (..._args: any[]) => [] as any[]);
	return {
		aiJobs: make(),
		workflows: make(),
		runnerJobs: make(),
		runnerEvents: make(),
		runnerInstances: make(),
	};
});

vi.mock('$lib/db/ai-orchestration.js', () => ({ listAIJobsForUser: aiJobs }));
vi.mock('$lib/db/workflows.js', () => ({
	listUserWorkflows: workflows,
	createUserWorkflow: async () => ({}),
}));
vi.mock('$lib/db/local-runners.js', () => ({
	getRunnerTokens: async () => [],
	createRunnerToken: async () => ({}),
	getRunnerJobs: runnerJobs,
	getRunnerInstances: runnerInstances,
	getRunnerEvents: runnerEvents,
}));

import { GET as getAiJobs } from '../routes/api/account/ai-jobs/+server.js';
import { GET as getWorkflows } from '../routes/api/account/workflows/+server.js';
import { GET as getRunners } from '../routes/api/account/runners/+server.js';

function ask(handler: any, path: string, query: string) {
	return handler({
		cookies: { get: () => 'u1' },
		platform: { env: { DB: {} } },
		url: new URL(`http://localhost/api/account/${path}${query}`),
	});
}

describe('account list ?limit= / ?offset=', () => {
	it('ai-jobs: clamps, floors and defaults', async () => {
		await ask(getAiJobs, 'ai-jobs', '?limit=1.5&offset=-3');
		expect(aiJobs).toHaveBeenLastCalledWith(
			{},
			'u1',
			expect.objectContaining({ limit: 1, offset: 0 })
		);
		await ask(getAiJobs, 'ai-jobs', '?limit=9999&offset=abc');
		expect(aiJobs).toHaveBeenLastCalledWith(
			{},
			'u1',
			expect.objectContaining({ limit: 200, offset: 0 })
		);
		await ask(getAiJobs, 'ai-jobs', '');
		expect(aiJobs).toHaveBeenLastCalledWith(
			{},
			'u1',
			expect.objectContaining({ limit: 50, offset: 0 })
		);
	});

	it('workflows: clamps and defaults', async () => {
		await ask(getWorkflows, 'workflows', '?limit=0');
		expect(workflows).toHaveBeenLastCalledWith({}, 'u1', expect.objectContaining({ limit: 1 }));
		await ask(getWorkflows, 'workflows', '?limit=500');
		expect(workflows).toHaveBeenLastCalledWith(
			{},
			'u1',
			expect.objectContaining({ limit: 200 })
		);
		await ask(getWorkflows, 'workflows', '?limit=x');
		expect(workflows).toHaveBeenLastCalledWith(
			{},
			'u1',
			expect.objectContaining({ limit: 100 })
		);
	});

	it('runners: clamps every limit and the offset', async () => {
		await ask(
			getRunners,
			'runners',
			'?jobsLimit=2.7&jobsOffset=-1&eventsLimit=9999&instancesLimit=zz'
		);
		expect(runnerJobs.mock.lastCall?.[3]).toMatchObject({ limit: 2, offset: 0 });
		expect(runnerEvents.mock.lastCall?.[2]).toMatchObject({ limit: 200 });
		expect(runnerInstances.mock.lastCall?.[2]).toMatchObject({ limit: 100 });
	});
});
