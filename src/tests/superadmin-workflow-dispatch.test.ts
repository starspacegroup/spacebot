import { beforeEach, describe, expect, it, vi } from 'vitest';

const operationMock = vi.fn(async (_key?: unknown, _ctx?: unknown): Promise<unknown> => ({
	ok: true,
}));
vi.mock('$lib/server/superadmin-workflow-operations.js', () => ({
	executeWorkflowOperation: (key, ctx) => operationMock(key, ctx),
	listWorkflowOperations: () => [],
}));

import { POST as dispatchPost } from '../routes/api/superadmin/workflows/dispatch/+server.js';
import {
	createSuperadminWorkflowTemplate,
	getSuperadminWorkflowRun,
	listSuperadminWorkflowRuns,
} from '../lib/db/superadmin-workflows.js';
import { OPERATION_TEMPLATES } from '../lib/server/superadmin-workflow-presets.js';
import { FakeWorkflowDb } from './helpers/fake-workflow-db.js';

function makePlatform(db, { queue = null } = {}) {
	const waits: Promise<unknown>[] = [];
	return {
		platform: {
			env: {
				DB: db,
				CRON_SECRET: 'test-secret',
				// The helper treats vite dev as queueless; force the durable path
				// when a queue is provided so tests exercise it.
				...(queue
					? { WORKFLOW_RUNS_QUEUE: queue, WORKFLOW_DURABLE_EXECUTION: 'true' }
					: {}),
			},
			context: {
				waitUntil: (p) => {
					waits.push(p);
				},
			},
		},
		flush: () => Promise.allSettled(waits),
	};
}

function makeEvent(platform) {
	return {
		request: new Request('http://localhost/api/superadmin/workflows/dispatch', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-secret' },
		}),
		cookies: { get: () => undefined },
		platform,
		fetch: globalThis.fetch,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

function makeQueue() {
	const messages = [];
	return {
		messages,
		send: async (msg) => {
			messages.push(msg);
		},
	};
}

async function makeCronTemplate(db, overrides = {}) {
	const result = await createSuperadminWorkflowTemplate(db, 'admin-1', {
		name: `Cron Flow ${Math.random().toString(36).slice(2, 8)}`,
		schedule_type: 'cron',
		cron_expression: '* * * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'work',
					type: 'task',
					title: 'Work',
					position: { x: 0, y: 140 },
					data: { operation: 'cronOp' },
				},
			],
			edges: [{ id: 'e1', source: 'start', target: 'work', label: 'start' }],
		},
		...overrides,
	});
	expect(result.success).toBe(true);
	return result.template;
}

beforeEach(() => {
	operationMock.mockReset();
	operationMock.mockImplementation(async () => ({ ok: true }));
});

describe('workflow dispatch endpoint', () => {
	it('tops up missing built-in presets on every tick', async () => {
		const db = new FakeWorkflowDb();
		const { platform, flush } = makePlatform(db);

		const response = await dispatchPost(makeEvent(platform));
		const body = await response.json();
		await flush();

		expect(body.success).toBe(true);
		expect(body.seeded).toHaveLength(OPERATION_TEMPLATES.length);
		expect(db.templates.every((t) => t.is_builtin === 1 || t.is_builtin === true)).toBe(true);
	});

	it('enqueues due cron runs onto the workflow-runs queue', async () => {
		const db = new FakeWorkflowDb();
		const queue = makeQueue();
		const { platform, flush } = makePlatform(db, { queue });
		const template = await makeCronTemplate(db);

		const response = await dispatchPost(makeEvent(platform));
		const body = await response.json();
		await flush();

		const mine = body.dispatched.find((d) => d.id === template.id);
		expect(mine).toBeTruthy();
		expect(mine.execution).toBe('workflow');

		const startMessages = queue.messages.filter((m) => m.type === 'superadmin_run_start');
		expect(startMessages.some((m) => m.runId === mine.run_id)).toBe(true);

		// Run stays queued for the worker; nothing executed inline.
		const run = await getSuperadminWorkflowRun(db, mine.run_id);
		expect(run.status).toBe('queued');
		expect(operationMock).not.toHaveBeenCalledWith('cronOp', expect.anything());
	});

	it('deduplicates dispatch within the same minute', async () => {
		const db = new FakeWorkflowDb();
		const queue = makeQueue();
		const { platform, flush } = makePlatform(db, { queue });
		const template = await makeCronTemplate(db);

		await dispatchPost(makeEvent(platform));
		const second = await dispatchPost(makeEvent(platform));
		const body = await second.json();
		await flush();

		const skipped = body.skipped.find((s) => s.id === template.id);
		expect(skipped?.reason).toBe('already_dispatched');

		const runs = await listSuperadminWorkflowRuns(db, { templateId: template.id });
		expect(runs).toHaveLength(1);
	});

	it('falls back to inline execution without the queue binding', async () => {
		const db = new FakeWorkflowDb();
		const { platform, flush } = makePlatform(db);
		const template = await makeCronTemplate(db);

		const response = await dispatchPost(makeEvent(platform));
		const body = await response.json();
		await flush();

		const mine = body.dispatched.find((d) => d.id === template.id);
		expect(mine.execution).toBe('inline');
		expect(body.durable_queue).toBe(false);

		const run = await getSuperadminWorkflowRun(db, mine.run_id);
		expect(run.status).toBe('completed');
		expect(operationMock).toHaveBeenCalledWith('cronOp', expect.anything());
	});

	it('watchdog re-enqueues stale queued runs', async () => {
		const db = new FakeWorkflowDb();
		const queue = makeQueue();
		const { platform, flush } = makePlatform(db, { queue });
		await makeCronTemplate(db, { schedule_type: 'manual', cron_expression: null });

		// A queued run whose start message was lost 5 minutes ago.
		const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000)
			.toISOString()
			.slice(0, 19)
			.replace('T', ' ');
		db.runs.push({
			id: 999,
			template_id: db.templates[0].id,
			template_version: 1,
			status: 'queued',
			trigger_source: 'manual',
			requested_by_user_id: 'admin-1',
			workflow_instance_id: null,
			legacy_history_id: null,
			input_json: null,
			state_json: JSON.stringify({ cursor: null, path: [], variables: { steps: {} } }),
			result_json: null,
			error_message: null,
			started_at: null,
			completed_at: null,
			duration_ms: null,
			created_at: staleCreatedAt,
			updated_at: staleCreatedAt,
		});

		const response = await dispatchPost(makeEvent(platform));
		const body = await response.json();
		await flush();

		const action = body.watchdog.find((a) => a.run_id === 999);
		expect(action?.action).toBe('re_enqueued');
		expect(
			queue.messages.some((m) => m.type === 'superadmin_run_start' && m.runId === 999)
		).toBe(true);
	});
});
