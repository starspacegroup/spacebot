import { describe, expect, it } from 'vitest';
import { MCPClient } from '../lib/ai/mcp-client.js';

interface FakeRunner {
	id: number;
	runner_token_id: number;
	token_name: string;
	user_id: string;
	instance_key: string;
	display_name: string;
	hostname: string;
	platform: string;
	platform_release: string;
	arch: string;
	runner_version: string;
	default_workdir: string;
	metadata: string;
	last_seen_at: string;
	last_disconnect_at: string | null;
	last_seen_ip: string;
	created_at: string;
	updated_at: string;
	is_online: number;
	pending_job_count: number;
	running_job_count: number;
}

interface FakeJob {
	id: number;
	runner_token_id: number;
	command: string;
	working_dir: string;
	status: string;
	label: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	target_instance_id: number | null;
	claimed_by_instance_id: number | null;
	target_instance_name?: string;
	claimed_by_instance_name?: string;
	token_name?: string;
	user_id: string;
	priority?: any;
	max_attempts?: any;
	timeout_seconds?: any;
	capability_requirements_json?: any;
}

interface FakeEvent {
	id: number;
	runner_token_id: number;
	runner_instance_id: number;
	job_id: number;
	event_type: string;
	level: string;
	message: string;
	details: string;
	created_at: string;
	instance_name: string;
	token_name: string;
	user_id: string;
}

class FakeMCPClient extends MCPClient {
	runners: FakeRunner[];
	jobs: FakeJob[];
	events: FakeEvent[];
	nextJobId: number;

	constructor() {
		super({ useLocalDb: true });
		this.runners = [
			{
				id: 11,
				runner_token_id: 1,
				token_name: 'Home Server',
				user_id: 'user-1',
				instance_key: 'host-a::linux::x64',
				display_name: 'Home Server / host-a',
				hostname: 'host-a',
				platform: 'linux',
				platform_release: '6.8.0',
				arch: 'x64',
				runner_version: '2026.05.07',
				default_workdir: '/srv/a',
				metadata: JSON.stringify({ shell: '/bin/sh' }),
				last_seen_at: '2026-05-07T10:00:00.000Z',
				last_disconnect_at: null,
				last_seen_ip: '10.0.0.9',
				created_at: '2026-05-07T09:00:00.000Z',
				updated_at: '2026-05-07T10:00:00.000Z',
				is_online: 1,
				pending_job_count: 0,
				running_job_count: 1,
			},
			{
				id: 12,
				runner_token_id: 1,
				token_name: 'Home Server',
				user_id: 'user-1',
				instance_key: 'host-b::linux::x64',
				display_name: 'Build Box / host-b',
				hostname: 'host-b',
				platform: 'linux',
				platform_release: '6.8.0',
				arch: 'x64',
				runner_version: '2026.05.07',
				default_workdir: '/srv/b',
				metadata: JSON.stringify({ shell: '/bin/sh' }),
				last_seen_at: '2026-05-06T08:00:00.000Z',
				last_disconnect_at: '2026-05-06T08:10:00.000Z',
				last_seen_ip: '10.0.0.10',
				created_at: '2026-05-06T07:00:00.000Z',
				updated_at: '2026-05-06T08:10:00.000Z',
				is_online: 0,
				pending_job_count: 1,
				running_job_count: 0,
			},
		];
		this.jobs = [
			{
				id: 44,
				runner_token_id: 1,
				command: 'git pull',
				working_dir: '/srv/a',
				status: 'running',
				label: 'Update repo',
				created_at: '2026-05-07T10:01:00.000Z',
				updated_at: '2026-05-07T10:01:10.000Z',
				completed_at: null,
				target_instance_id: 11,
				claimed_by_instance_id: 11,
				target_instance_name: 'Home Server / host-a',
				claimed_by_instance_name: 'Home Server / host-a',
				token_name: 'Home Server',
				user_id: 'user-1',
			},
		];
		this.events = [
			{
				id: 71,
				runner_token_id: 1,
				runner_instance_id: 11,
				job_id: 44,
				event_type: 'job.started',
				level: 'info',
				message: 'Started job #44',
				details: JSON.stringify({ command: 'git pull' }),
				created_at: '2026-05-07T10:01:00.000Z',
				instance_name: 'Home Server / host-a',
				token_name: 'Home Server',
				user_id: 'user-1',
			},
		];
		this.nextJobId = 100;
	}

	async executeD1Query(sql: string, params: any[] = []): Promise<any> {
		if (sql.includes('FROM local_runner_instances i')) {
			const userId = params[0];
			const hasTokenFilter = sql.includes('AND i.runner_token_id = ?');
			const tokenId = hasTokenFilter ? params[1] : null;
			const limit = params[params.length - 1];
			return {
				results: this.runners
					.filter((runner) => runner.user_id === userId)
					.filter((runner) => (tokenId ? runner.runner_token_id === tokenId : true))
					.slice(0, limit),
				success: true,
			};
		}

		if (sql.includes('FROM local_runner_events e')) {
			const userId = params[0];
			const limit = params[params.length - 1];
			return {
				results: this.events.filter((event) => event.user_id === userId).slice(0, limit),
				success: true,
			};
		}

		if (sql.includes('FROM local_runner_jobs j')) {
			const userId = params[0];
			const limit = params[params.length - 1];
			return {
				results: this.jobs.filter((job) => job.user_id === userId).slice(0, limit),
				success: true,
			};
		}

		if (sql.includes('INSERT INTO local_runner_jobs')) {
			const [
				tokenId,
				userId,
				command,
				workingDir,
				label,
				targetInstanceId,
				priority,
				maxAttempts,
				timeoutSeconds,
				capabilityRequirementsJson,
			] = params;
			const job = {
				id: this.nextJobId++,
				runner_token_id: tokenId,
				user_id: userId,
				command,
				working_dir: workingDir,
				label,
				status: 'pending',
				target_instance_id: targetInstanceId,
				priority,
				max_attempts: maxAttempts,
				timeout_seconds: timeoutSeconds,
				capability_requirements_json: capabilityRequirementsJson,
				claimed_by_instance_id: null,
				created_at: '2026-05-07T11:00:00.000Z',
				updated_at: '2026-05-07T11:00:00.000Z',
				completed_at: null,
			};
			this.jobs.push(job);
			return { results: [{ id: job.id }], success: true };
		}

		throw new Error(`Unhandled SQL in FakeMCPClient: ${sql}`);
	}
}

describe('local runner MCP tools', () => {
	it('lists runner systems with parsed metadata and online state', async () => {
		const client = new FakeMCPClient();

		const runners = await client.getLocalRunners('user-1', { includeOffline: true });

		expect(runners).toHaveLength(2);
		expect(runners[0].metadata).toEqual({ shell: '/bin/sh' });
		expect(runners[0].is_online).toBe(true);
		expect(runners[1].is_online).toBe(false);
	});

	it('summarizes runner activity with active jobs and recent events', async () => {
		const client = new FakeMCPClient();

		const activity = await client.getLocalRunnerActivity('user-1', { limit: 10 });

		expect(activity.runners).toHaveLength(2);
		expect(activity.activeJobs).toHaveLength(1);
		expect(activity.activeJobs[0].status).toBe('running');
		expect(activity.recentEvents[0].details).toEqual({ command: 'git pull' });
	});

	it('queues one task per matched runner system when targeting by name or mode', async () => {
		const client = new FakeMCPClient();

		const targeted = await client.startLocalRunnerTask('user-1', {
			command: 'git fetch --all',
			instanceNames: ['build box'],
			label: 'Refresh remotes',
		});

		expect(targeted.queuedCount).toBe(1);
		expect(targeted.queuedJobs[0].runnerName).toBe('Build Box / host-b');

		const allKnown = await client.startLocalRunnerTask('user-1', {
			command: 'uptime',
			targetMode: 'all-known',
		});

		expect(allKnown.queuedCount).toBe(2);
		expect(client.jobs.filter((job) => job.command === 'uptime')).toHaveLength(2);
	});
});