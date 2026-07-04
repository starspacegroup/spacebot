import { beforeEach, describe, expect, it, vi } from 'vitest';

const operationMock = vi.fn(async (_key?: unknown, _ctx?: unknown): Promise<unknown> => ({
	ok: true,
}));
vi.mock('$lib/server/superadmin-workflow-operations.js', () => ({
	executeWorkflowOperation: (key, ctx) => operationMock(key, ctx),
	listWorkflowOperations: () => [],
}));

import {
	createSuperadminWorkflowRun,
	createSuperadminWorkflowTemplate,
	getSuperadminWorkflowRun,
	updateSuperadminWorkflowRun,
} from '../lib/db/superadmin-workflows.js';
import {
	advanceSuperadminWorkflowRun,
	driveSuperadminWorkflowRunInline,
} from '../lib/server/superadmin-workflow-advance.js';
import { FakeWorkflowDb } from './helpers/fake-workflow-db.js';

const noSleep = { sleep: async () => {}, inlineSleepCapSeconds: 100000 };

function linearCanvas() {
	return {
		nodes: [
			{ id: 'start', type: 'trigger', title: 'Start', position: { x: 0, y: 0 }, data: {} },
			{
				id: 'one',
				type: 'task',
				title: 'One',
				position: { x: 0, y: 140 },
				data: { operation: 'opOne' },
			},
			{
				id: 'two',
				type: 'task',
				title: 'Two',
				position: { x: 0, y: 280 },
				data: { operation: 'opTwo' },
			},
		],
		edges: [
			{ id: 'e1', source: 'start', target: 'one', label: 'start' },
			{ id: 'e2', source: 'one', target: 'two', label: 'success' },
		],
	};
}

async function makeRun(db, canvas, { input = null } = {}) {
	const created = await createSuperadminWorkflowTemplate(db, 'admin-1', {
		name: `Flow ${Math.random().toString(36).slice(2, 8)}`,
		canvas_json: canvas,
	});
	expect(created.success).toBe(true);
	const runResult = await createSuperadminWorkflowRun(db, created.template.id, 'admin-1', {
		status: 'queued',
		input_json: input,
	});
	expect(runResult.success).toBe(true);
	return { template: created.template, run: runResult.run };
}

beforeEach(() => {
	operationMock.mockReset();
	operationMock.mockImplementation(async () => ({ ok: true }));
});

describe('advanceSuperadminWorkflowRun', () => {
	it('completes a linear graph one node per call', async () => {
		const db = new FakeWorkflowDb();
		const { run } = await makeRun(db, linearCanvas());

		const first = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(first.status).toBe('running');
		expect(first.executed_step.step_key).toBe('start');
		expect(first.done).toBe(false);

		const second = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(second.executed_step.step_key).toBe('one');

		const third = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(third.executed_step.step_key).toBe('two');
		expect(third.done).toBe(true);
		expect(third.status).toBe('completed');

		const final = await getSuperadminWorkflowRun(db, run.id);
		expect(final.status).toBe('completed');
		expect(final.result_json.executed_steps.map((s) => s.step_key)).toEqual([
			'start',
			'one',
			'two',
		]);
		expect(final.steps.every((s) => s.status === 'completed')).toBe(true);
		expect(operationMock).toHaveBeenCalledTimes(2);
	});

	it('replaying a terminal run returns done without re-executing', async () => {
		const db = new FakeWorkflowDb();
		const { run } = await makeRun(db, linearCanvas());
		await driveSuperadminWorkflowRunInline({ db, fetch, runId: run.id }, noSleep);
		operationMock.mockClear();

		const replay = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(replay.done).toBe(true);
		expect(replay.status).toBe('completed');
		expect(operationMock).not.toHaveBeenCalled();
	});

	it('routes branches by rule evaluation', async () => {
		const db = new FakeWorkflowDb();
		const canvas = {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'check',
					type: 'branch',
					title: 'Check',
					position: { x: 0, y: 140 },
					data: {
						condition_mode: 'rule',
						left_operand: '{input.flag}',
						operator: 'equals',
						right_operand: 'yes',
					},
				},
				{
					id: 'yes',
					type: 'task',
					title: 'Yes',
					position: { x: -100, y: 280 },
					data: { operation: 'yesOp' },
				},
				{
					id: 'no',
					type: 'task',
					title: 'No',
					position: { x: 100, y: 280 },
					data: { operation: 'noOp' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'check', label: 'start' },
				{ id: 'e2', source: 'check', target: 'yes', source_handle: 'true', label: 'true' },
				{ id: 'e3', source: 'check', target: 'no', source_handle: 'false', label: 'false' },
			],
		};

		const { run } = await makeRun(db, canvas, { input: { flag: 'yes' } });
		const result = await driveSuperadminWorkflowRunInline(
			{ db, fetch, runId: run.id },
			noSleep
		);
		expect(result.status).toBe('completed');
		expect(operationMock).toHaveBeenCalledWith('yesOp', expect.anything());
		expect(operationMock).not.toHaveBeenCalledWith('noOp', expect.anything());

		const final = await getSuperadminWorkflowRun(db, run.id);
		const skipped = final.steps.find((s) => s.step_key === 'no');
		expect(skipped.status).toBe('skipped');
	});

	it('pauses on approval gates and resumes on a recorded decision', async () => {
		const db = new FakeWorkflowDb();
		const canvas = {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'gate',
					type: 'approval',
					title: 'Gate',
					position: { x: 0, y: 140 },
					data: { requiresConfirmation: true },
				},
				{
					id: 'work',
					type: 'task',
					title: 'Work',
					position: { x: 0, y: 280 },
					data: { operation: 'gatedOp' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'gate', label: 'start' },
				{
					id: 'e2',
					source: 'gate',
					target: 'work',
					source_handle: 'approved',
					label: 'approved',
				},
			],
		};

		const { run } = await makeRun(db, canvas);
		const paused = await driveSuperadminWorkflowRunInline(
			{ db, fetch, runId: run.id },
			noSleep
		);
		expect(paused.status).toBe('waiting_approval');
		expect(paused.wait).toMatchObject({ type: 'approval', step_key: 'gate' });
		expect(operationMock).not.toHaveBeenCalled();

		// Idempotent replay while waiting.
		const replay = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(replay.status).toBe('waiting_approval');

		// Record the decision (as the approval endpoint does), then resume.
		const waiting = await getSuperadminWorkflowRun(db, run.id);
		const state = waiting.state_json;
		state.approvals = {
			gate: {
				decision: 'approved',
				decided_by: 'admin-1',
				decided_at: new Date().toISOString(),
			},
		};
		await updateSuperadminWorkflowRun(db, run.id, { state_json: state });

		const resumed = await driveSuperadminWorkflowRunInline(
			{ db, fetch, runId: run.id },
			noSleep
		);
		expect(resumed.status).toBe('completed');
		expect(operationMock).toHaveBeenCalledWith('gatedOp', expect.anything());

		const final = await getSuperadminWorkflowRun(db, run.id);
		const gateStep = final.steps.find((s) => s.step_key === 'gate');
		expect(gateStep.status).toBe('completed');
		expect(gateStep.output_json.decision).toBe('approved');
	});

	it('applies the timeout route when an approval gate expires', async () => {
		const db = new FakeWorkflowDb();
		const canvas = {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'gate',
					type: 'approval',
					title: 'Gate',
					position: { x: 0, y: 140 },
					data: {
						requiresConfirmation: true,
						timeout_hours: 1,
						timeout_route: 'rejected',
					},
				},
				{
					id: 'work',
					type: 'task',
					title: 'Work',
					position: { x: 0, y: 280 },
					data: { operation: 'gatedOp' },
				},
				{
					id: 'cleanup',
					type: 'task',
					title: 'Cleanup',
					position: { x: 100, y: 280 },
					data: { operation: 'cleanupOp' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'gate', label: 'start' },
				{
					id: 'e2',
					source: 'gate',
					target: 'work',
					source_handle: 'approved',
					label: 'approved',
				},
				{
					id: 'e3',
					source: 'gate',
					target: 'cleanup',
					source_handle: 'rejected',
					label: 'rejected',
				},
			],
		};

		const { run } = await makeRun(db, canvas);
		await driveSuperadminWorkflowRunInline({ db, fetch, runId: run.id }, noSleep);

		// Advance again from a time past the gate timeout.
		const future = new Date(Date.now() + 2 * 3600 * 1000);
		const afterTimeout = await advanceSuperadminWorkflowRun({
			db,
			fetch,
			runId: run.id,
			now: future,
		});
		expect(['running', 'completed']).toContain(afterTimeout.status);

		const final = await driveSuperadminWorkflowRunInline({ db, fetch, runId: run.id }, noSleep);
		expect(final.status).toBe('completed');
		expect(operationMock).toHaveBeenCalledWith('cleanupOp', expect.anything());
		expect(operationMock).not.toHaveBeenCalledWith('gatedOp', expect.anything());
	});

	it('parks timed tasks and executes them after the wake time', async () => {
		const db = new FakeWorkflowDb();
		const canvas = {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'later',
					type: 'task',
					title: 'Later',
					position: { x: 0, y: 140 },
					data: {
						operation: 'delayedOp',
						module_config: { timing: { mode: 'delay_minutes', delay_minutes: 10 } },
					},
				},
			],
			edges: [{ id: 'e1', source: 'start', target: 'later', label: 'start' }],
		};

		const { run } = await makeRun(db, canvas);
		await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id }); // trigger

		const parked = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(parked.status).toBe('sleeping');
		expect(parked.wait.type).toBe('sleep');
		expect(parked.wait.seconds).toBeGreaterThan(500);
		expect(operationMock).not.toHaveBeenCalled();

		// Replay before due: same instruction, still no execution.
		const replay = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(replay.status).toBe('sleeping');
		expect(operationMock).not.toHaveBeenCalled();

		// Wake after the delay.
		const wake = new Date(Date.now() + 11 * 60 * 1000);
		const done = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, now: wake });
		expect(done.done).toBe(true);
		expect(done.status).toBe('completed');
		expect(operationMock).toHaveBeenCalledWith('delayedOp', expect.anything());
	});

	it('retries failed operations with backoff, then poison-fails', async () => {
		const db = new FakeWorkflowDb();
		operationMock.mockImplementation(async () => {
			throw new Error('boom');
		});

		const { run } = await makeRun(db, linearCanvas());
		await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id }); // trigger

		// Attempt 1 → retry with backoff.
		const retry1 = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(retry1.status).toBe('sleeping');
		expect(retry1.executed_step.status).toBe('retrying');
		expect(retry1.wait.seconds).toBe(30);

		// Attempt 2 (after backoff) → retry again, doubled delay.
		let wake = new Date(Date.now() + 31 * 1000);
		const retry2 = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, now: wake });
		expect(retry2.status).toBe('sleeping');
		expect(retry2.wait.seconds).toBe(60);

		// Attempt 3 → retry limit (3) reached → run fails.
		wake = new Date(wake.getTime() + 61 * 1000);
		const failed = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, now: wake });
		expect(failed.done).toBe(true);
		expect(failed.status).toBe('failed');

		const final = await getSuperadminWorkflowRun(db, run.id);
		expect(final.status).toBe('failed');
		expect(final.error_message).toBe('boom');
		const failedStep = final.steps.find((s) => s.step_key === 'one');
		expect(failedStep.status).toBe('failed');
		const skipped = final.steps.find((s) => s.step_key === 'two');
		expect(skipped.status).toBe('skipped');
	});

	it('recovers when a retried operation succeeds', async () => {
		const db = new FakeWorkflowDb();
		let calls = 0;
		operationMock.mockImplementation(async () => {
			calls += 1;
			if (calls === 1) throw new Error('flaky');
			return { ok: true, calls };
		});

		const { run } = await makeRun(db, linearCanvas());
		await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id }); // trigger
		const retry = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });
		expect(retry.status).toBe('sleeping');

		const wake = new Date(Date.now() + 31 * 1000);
		const recovered = await advanceSuperadminWorkflowRun({
			db,
			fetch,
			runId: run.id,
			now: wake,
		});
		expect(recovered.executed_step).toMatchObject({ step_key: 'one', status: 'completed' });

		const done = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, now: wake });
		expect(done.done).toBe(true);
		expect(done.status).toBe('completed');
	});

	it('poison-fails cyclic graphs at the step budget', async () => {
		const db = new FakeWorkflowDb();
		const canvas = {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Start',
					position: { x: 0, y: 0 },
					data: {},
				},
				{
					id: 'a',
					type: 'task',
					title: 'A',
					position: { x: 0, y: 140 },
					data: { operation: 'loopOp' },
				},
				{
					id: 'b',
					type: 'task',
					title: 'B',
					position: { x: 0, y: 280 },
					data: { operation: 'loopOp' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'a', label: 'start' },
				{ id: 'e2', source: 'a', target: 'b', label: 'next' },
				{ id: 'e3', source: 'b', target: 'a', label: 'next' },
			],
		};

		const { run } = await makeRun(db, canvas);
		const result = await driveSuperadminWorkflowRunInline(
			{ db, fetch, runId: run.id },
			{ ...noSleep, maxIterations: 600 }
		);
		expect(result.done).toBe(true);
		expect(result.status).toBe('failed');

		const final = await getSuperadminWorkflowRun(db, run.id);
		expect(final.error_message).toContain('max execution steps');
	});

	it('poison-fails runs past their deadline', async () => {
		const db = new FakeWorkflowDb();
		const { run } = await makeRun(db, linearCanvas());
		await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id });

		const past = new Date(Date.now() + 25 * 3600 * 1000);
		const result = await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, now: past });
		expect(result.done).toBe(true);
		expect(result.status).toBe('failed');

		const final = await getSuperadminWorkflowRun(db, run.id);
		expect(final.error_message).toContain('max run duration');
	});

	it('records the workflow instance id on first contact', async () => {
		const db = new FakeWorkflowDb();
		const { run } = await makeRun(db, linearCanvas());

		await advanceSuperadminWorkflowRun({ db, fetch, runId: run.id, instanceId: 'sa-run-1' });
		const loaded = await getSuperadminWorkflowRun(db, run.id);
		expect(loaded.workflow_instance_id).toBe('sa-run-1');
	});
});
