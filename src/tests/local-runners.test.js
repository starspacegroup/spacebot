import { describe, expect, it } from 'vitest';
import {
	claimPendingJobs,
	createRunnerJob,
	getRunnerEvents,
	getRunnerInstances,
	recordRunnerEvent,
	registerRunnerInstance,
} from '../lib/db/local-runners.js';

class FakeStatement {
	constructor(db, sql) {
		this.db = db;
		this.sql = sql;
		this.args = [];
	}

	bind(...args) {
		this.args = args;
		return this;
	}

	async first() {
		return this.db.execute(this.sql, this.args, 'first');
	}

	async all() {
		return this.db.execute(this.sql, this.args, 'all');
	}

	async run() {
		return this.db.execute(this.sql, this.args, 'run');
	}

	catch() {
		return this;
	}
}

class FakeDb {
	constructor() {
		this.tokens = [
			{ id: 1, user_id: 'user-1', name: 'Home Server', revoked: 0 },
			{ id: 2, user_id: 'user-2', name: 'Other User', revoked: 0 },
		];
		this.instances = [];
		this.jobs = [];
		this.events = [];
		this.nextInstanceId = 1;
		this.nextJobId = 1;
		this.nextEventId = 1;
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	execute(sql, args, mode) {
		if (sql.includes('SELECT id FROM local_runner_tokens WHERE id = ? AND user_id = ? AND revoked = 0')) {
			const [tokenId, userId] = args;
			return this.tokens.find((token) => token.id === tokenId && token.user_id === userId && token.revoked === 0) || null;
		}

		if (sql.includes('FROM local_runner_instances') && sql.includes('instance_key = ?') && !sql.includes('JOIN local_runner_tokens')) {
			const [tokenId, instanceKey] = args;
			return this.instances.find((instance) => instance.runner_token_id === tokenId && instance.instance_key === instanceKey) || null;
		}

		if (sql.includes('INSERT INTO local_runner_instances')) {
			const [tokenId, userId, instanceKey, displayName, hostname, platform, platformRelease, arch, runnerVersion, defaultWorkdir, metadata, lastSeenIp] = args;
			this.instances.push({
				id: this.nextInstanceId++,
				runner_token_id: tokenId,
				user_id: userId,
				instance_key: instanceKey,
				display_name: displayName,
				hostname: hostname,
				platform,
				platform_release: platformRelease,
				arch,
				runner_version: runnerVersion,
				default_workdir: defaultWorkdir,
				metadata,
				last_seen_at: new Date().toISOString(),
				last_seen_ip: lastSeenIp,
				last_disconnect_at: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			});
			return { success: true };
		}

		if (sql.includes('UPDATE local_runner_instances') && sql.includes('WHERE id = ?')) {
			const [displayName, hostname, platform, platformRelease, arch, runnerVersion, defaultWorkdir, metadata, lastSeenIp, id] = args;
			const instance = this.instances.find((entry) => entry.id === id);
			if (instance) {
				Object.assign(instance, {
					display_name: displayName,
					hostname,
					platform,
					platform_release: platformRelease,
					arch,
					runner_version: runnerVersion,
					default_workdir: defaultWorkdir,
					metadata,
					last_seen_ip: lastSeenIp,
					last_seen_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				});
			}
			return { success: true, meta: { changes: instance ? 1 : 0 } };
		}

		if (sql.includes('FROM local_runner_instances i') && sql.includes('WHERE i.runner_token_id = ? AND i.instance_key = ?')) {
			const [, tokenId, instanceKey] = args;
			const instance = this.instances.find((entry) => entry.runner_token_id === tokenId && entry.instance_key === instanceKey);
			if (!instance) return null;
			const token = this.tokens.find((entry) => entry.id === instance.runner_token_id);
			return {
				...instance,
				token_name: token?.name ?? null,
				is_online: 1,
			};
		}

		if (sql.includes('FROM local_runner_instances i') && sql.includes('WHERE i.user_id = ?')) {
			const [, userId] = args;
			return {
				results: this.instances
					.filter((instance) => instance.user_id === userId)
					.map((instance) => ({ ...instance, token_name: this.tokens.find((token) => token.id === instance.runner_token_id)?.name ?? null, is_online: 1 })),
			};
		}

		if (sql.includes('FROM local_runner_instances') && sql.includes('WHERE id = ? AND runner_token_id = ? AND user_id = ?')) {
			const [instanceId, tokenId, userId] = args;
			return this.instances.find((instance) => instance.id === instanceId && instance.runner_token_id === tokenId && instance.user_id === userId) || null;
		}

		if (sql.includes('INSERT INTO local_runner_jobs')) {
			const [tokenId, userId, command, workingDir, label, targetInstanceId] = args;
			const job = {
				id: this.nextJobId++,
				runner_token_id: tokenId,
				user_id: userId,
				command,
				working_dir: workingDir,
				label,
				status: 'pending',
				target_instance_id: targetInstanceId,
				claimed_by_instance_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
			};
			this.jobs.push(job);
			return { id: job.id };
		}

		if (sql.includes('SELECT id, command, working_dir, label, target_instance_id') && sql.includes('FROM local_runner_jobs')) {
			const [tokenId, instanceId] = args;
			return {
				results: this.jobs.filter((job) => job.runner_token_id === tokenId && job.status === 'pending' && (job.target_instance_id == null || job.target_instance_id === instanceId)),
			};
		}

		if (sql.includes('UPDATE local_runner_jobs') && sql.includes("SET status = 'running', claimed_by_instance_id = ?")) {
			const [instanceId, jobId] = args;
			const job = this.jobs.find((entry) => entry.id === jobId && entry.status === 'pending');
			if (!job) return { meta: { changes: 0 } };
			job.status = 'running';
			job.claimed_by_instance_id = instanceId;
			job.updated_at = new Date().toISOString();
			return { meta: { changes: 1 } };
		}

		if (sql.includes('INSERT INTO local_runner_events')) {
			const [userId, tokenId, instanceId, jobId, eventType, level, message, details] = args;
			const event = {
				id: this.nextEventId++,
				user_id: userId,
				runner_token_id: tokenId,
				runner_instance_id: instanceId,
				job_id: jobId,
				event_type: eventType,
				level,
				message,
				details,
				created_at: new Date().toISOString(),
			};
			this.events.push(event);
			return event;
		}

		if (sql.includes('FROM local_runner_events e')) {
			const [userId, limit] = args;
			return {
				results: this.events
					.filter((event) => event.user_id === userId)
					.slice()
					.reverse()
					.slice(0, limit)
					.map((event) => ({
						...event,
						instance_name: this.instances.find((instance) => instance.id === event.runner_instance_id)?.display_name ?? null,
						token_name: this.tokens.find((token) => token.id === event.runner_token_id)?.name ?? null,
					})),
			};
		}

		throw new Error(`Unhandled SQL in local-runners test fake: ${sql} (${mode})`);
	}
}

describe('local runner data layer', () => {
	it('registers concrete runner instances and returns parsed metadata', async () => {
		const db = new FakeDb();

		const registration = await registerRunnerInstance(db, {
			tokenId: 1,
			userId: 'user-1',
			instanceKey: 'host-a::linux::x64',
			displayName: 'Home Server / host-a',
			hostname: 'host-a',
			platform: 'linux',
			platformRelease: '6.8.0',
			arch: 'x64',
			runnerVersion: '1.0.0',
			defaultWorkdir: '/srv/spacebot',
			metadata: { shell: '/bin/sh' },
		}, '10.0.0.9');

		expect(registration.success).toBe(true);
		expect(registration.instance.display_name).toBe('Home Server / host-a');
		expect(registration.instance.metadata).toEqual({ shell: '/bin/sh' });

		const instances = await getRunnerInstances(db, 'user-1');
		expect(instances).toHaveLength(1);
		expect(instances[0].is_online).toBe(true);
	});

	it('creates instance-targeted jobs and only lets the matching instance claim them', async () => {
		const db = new FakeDb();
		const registration = await registerRunnerInstance(db, {
			tokenId: 1,
			userId: 'user-1',
			instanceKey: 'host-a::linux::x64',
			displayName: 'Home Server / host-a',
		}, '10.0.0.9');

		const other = await registerRunnerInstance(db, {
			tokenId: 1,
			userId: 'user-1',
			instanceKey: 'host-b::linux::x64',
			displayName: 'Build Box / host-b',
		}, '10.0.0.10');

		const job = await createRunnerJob(db, 'user-1', 1, {
			command: 'git pull',
			label: 'Update repo',
			target_instance_id: other.instance.id,
		});

		expect(job.success).toBe(true);

		const firstClaim = await claimPendingJobs(db, 1, registration.instance.id);
		expect(firstClaim).toHaveLength(0);

		const secondClaim = await claimPendingJobs(db, 1, other.instance.id);
		expect(secondClaim).toHaveLength(1);
		expect(secondClaim[0].command).toBe('git pull');
	});

	it('stores runner events with structured details for later activity queries', async () => {
		const db = new FakeDb();
		const registration = await registerRunnerInstance(db, {
			tokenId: 1,
			userId: 'user-1',
			instanceKey: 'host-a::linux::x64',
			displayName: 'Home Server / host-a',
		}, '10.0.0.9');

		const stored = await recordRunnerEvent(db, {
			userId: 'user-1',
			tokenId: 1,
			instanceId: registration.instance.id,
			eventType: 'job.completed',
			message: 'Update repo finished successfully',
			details: { exitCode: 0, bytes: 128 },
		});

		expect(stored.success).toBe(true);

		const events = await getRunnerEvents(db, 'user-1', { limit: 10 });
		expect(events).toHaveLength(1);
		expect(events[0].event_type).toBe('job.completed');
		expect(events[0].details).toEqual({ exitCode: 0, bytes: 128 });
		expect(events[0].instance_name).toBe('Home Server / host-a');
	});
});