import { describe, expect, it } from 'vitest';
import { MCPClient } from '../lib/ai/mcp-client.js';

/**
 * Covers the synchronous-result behavior of start_local_runner_task: when a
 * task targets exactly one ONLINE runner it waits for completion and surfaces
 * the real output/exitCode/status, so the DM assistant can report the actual
 * result in the same turn. Multi-target / offline / opt-out stay fire-and-queue.
 */

interface FakeJobRow {
	id: number;
	user_id: string;
	runner_token_id: number;
	command: string;
	status: string;
	exit_code: number | null;
	output: string | null;
	terminal_error: string | null;
	target_instance_id: number | null;
}

class FakeMCPClient extends MCPClient {
	runners: any[];
	jobs: FakeJobRow[];
	nextJobId: number;

	constructor(runners: any[]) {
		super({ useLocalDb: true });
		this.runners = runners;
		this.jobs = [];
		this.nextJobId = 500;
	}

	async executeD1Query(sql: string, params: any[] = []): Promise<any> {
		if (sql.includes('FROM local_runner_instances i')) {
			const userId = params[0];
			const limit = params[params.length - 1];
			return {
				results: this.runners.filter((r) => r.user_id === userId).slice(0, limit),
				success: true,
			};
		}

		// Single-job lookup used by the wait poll (getLocalRunnerJob).
		if (sql.includes('WHERE j.id = ?')) {
			const [jobId, userId] = params;
			const row = this.jobs.find((j) => j.id === jobId && j.user_id === userId);
			return { results: row ? [row] : [], success: true };
		}

		if (sql.includes('INSERT INTO local_runner_jobs')) {
			const [tokenId, userId, command, , , targetInstanceId] = params;
			// Newly inserted jobs are pre-seeded via seedJob(); if none was seeded
			// for this command, default to a completed no-op so tests stay fast.
			const seeded = this.jobs.find(
				(j) => j.command === command && j.id >= this.nextJobId - 50 && j.user_id === userId
			);
			const job: FakeJobRow = seeded ?? {
				id: this.nextJobId++,
				user_id: userId,
				runner_token_id: tokenId,
				command,
				status: 'completed',
				exit_code: 0,
				output: 'ok',
				terminal_error: null,
				target_instance_id: targetInstanceId,
			};
			if (!seeded) this.jobs.push(job);
			return { results: [{ id: job.id }], success: true };
		}

		throw new Error(`Unhandled SQL in FakeMCPClient: ${sql}`);
	}
}

function onlineRunner(overrides: Partial<any> = {}) {
	return {
		id: 11,
		runner_token_id: 1,
		token_name: 'Home',
		user_id: 'user-1',
		display_name: 'Dirac',
		hostname: 'dirac',
		platform: 'linux',
		arch: 'x64',
		default_workdir: '/home/me',
		metadata: JSON.stringify({}),
		is_online: 1,
		pending_job_count: 0,
		running_job_count: 0,
		...overrides,
	};
}

describe('start_local_runner_task synchronous result', () => {
	it('waits for a single online runner and returns real output/exitCode/status', async () => {
		const client = new FakeMCPClient([onlineRunner()]);
		// Pre-seed the job the insert will resolve to, already completed.
		client.jobs.push({
			id: 500,
			user_id: 'user-1',
			runner_token_id: 1,
			command: 'bun test',
			status: 'completed',
			exit_code: 0,
			output: '42 passed',
			terminal_error: null,
			target_instance_id: 11,
		});
		client.nextJobId = 501;

		const result = await client.startLocalRunnerTask('user-1', { command: 'bun test' });

		expect(result.awaited).toBe(true);
		expect(result.queuedCount).toBe(1);
		const job = result.queuedJobs[0];
		expect(job.waitStatus).toBe('done');
		expect(job.status).toBe('completed');
		expect(job.exitCode).toBe(0);
		expect(job.output).toBe('42 passed');
	});

	it('surfaces a non-zero exit code and error output from a failed command', async () => {
		const client = new FakeMCPClient([onlineRunner()]);
		client.jobs.push({
			id: 500,
			user_id: 'user-1',
			runner_token_id: 1,
			command: 'false',
			status: 'failed',
			exit_code: 1,
			output: 'command failed',
			terminal_error: 'nonzero exit',
			target_instance_id: 11,
		});
		client.nextJobId = 501;

		const result = await client.startLocalRunnerTask('user-1', { command: 'false' });

		expect(result.awaited).toBe(true);
		expect(result.queuedJobs[0].status).toBe('failed');
		expect(result.queuedJobs[0].exitCode).toBe(1);
		expect(result.queuedJobs[0].terminalError).toBe('nonzero exit');
	});

	it('does not wait when waitForResult is explicitly false', async () => {
		const client = new FakeMCPClient([onlineRunner()]);

		const result = await client.startLocalRunnerTask('user-1', {
			command: 'sleep 60',
			waitForResult: false,
		});

		expect(result.awaited).toBe(false);
		expect(result.queuedJobs[0].output).toBeUndefined();
		expect(result.queuedJobs[0].waitStatus).toBeUndefined();
	});

	it('does not wait when the only matched runner is offline', async () => {
		const client = new FakeMCPClient([onlineRunner({ is_online: 0 })]);

		const result = await client.startLocalRunnerTask('user-1', { command: 'git pull' });

		expect(result.awaited).toBe(false);
		expect(result.queuedJobs[0].isOnline).toBe(false);
	});

	it('does not wait when fanning out to multiple runners', async () => {
		const client = new FakeMCPClient([
			onlineRunner({ id: 11, display_name: 'Dirac', hostname: 'dirac' }),
			onlineRunner({ id: 12, display_name: 'Build', hostname: 'build' }),
		]);

		const result = await client.startLocalRunnerTask('user-1', {
			command: 'uptime',
			targetMode: 'all-online',
		});

		expect(result.queuedCount).toBe(2);
		expect(result.awaited).toBe(false);
	});

	it('reports timeout when a single online job does not finish in time', async () => {
		const client = new FakeMCPClient([onlineRunner()]);
		client.jobs.push({
			id: 500,
			user_id: 'user-1',
			runner_token_id: 1,
			command: 'long-build',
			status: 'running',
			exit_code: null,
			output: null,
			terminal_error: null,
			target_instance_id: 11,
		});
		client.nextJobId = 501;

		const result = await client.startLocalRunnerTask('user-1', {
			command: 'long-build',
			waitSeconds: 1,
		});

		expect(result.awaited).toBe(true);
		expect(result.queuedJobs[0].waitStatus).toBe('timeout');
		expect(result.queuedJobs[0].status).toBe('running');
	});
});
