/**
 * Durable advance-loop runtime for superadmin workflows.
 *
 * `advanceSuperadminWorkflowRun` executes AT MOST ONE graph node per call and
 * persists all loop state in the run's `state_json`, so a Cloudflare Workflow
 * instance (orchestrator-worker `SuperadminRunWorkflow`) can drive a run as a
 * series of durable `step.do()` calls with retries, sleeping between timed
 * steps and pausing on approval gates. The call is idempotent: replaying it
 * while a run sleeps/waits returns the same wait instruction without
 * re-executing work, and replaying a terminal run returns `done`.
 *
 * `driveSuperadminWorkflowRunInline` loops advance in-process — the dev
 * fallback when no queue/Workflow binding exists, and the unit-test harness.
 *
 * Graph semantics (branch evaluation, edge selection, {token} templating,
 * custom actions, operations) are shared with the legacy inline runtime in
 * superadmin-workflow-runtime.ts — that module remains the single source of
 * those behaviors.
 */

import {
	getSuperadminWorkflowRun,
	getSuperadminWorkflowTemplate,
	updateSuperadminWorkflowRun,
	updateSuperadminWorkflowRunStep,
} from '$lib/db/superadmin-workflows.js';
import { getTemplateVersion } from '$lib/db/superadmin-workflow-versions.js';
import { executeWorkflowOperation } from '$lib/server/superadmin-workflow-operations.js';
import {
	asObject,
	computeTaskTimingPlan,
	evaluateBranchNode,
	executeLegacyBridgeRun,
	markUnreachedStepsAsSkipped,
	normalizeTaskModuleConfig,
	nowSql,
	resolveDataDeep,
	runCustomActions,
	selectNextEdge,
} from '$lib/server/superadmin-workflow-runtime.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_STEPS = 500;
const DEFAULT_RETRY_LIMIT = 3;
const RETRY_BASE_DELAY_SECONDS = 30;
const DEFAULT_APPROVAL_TIMEOUT_HOURS = 72;

interface AdvanceArgs {
	db: unknown;
	platform?: unknown;
	fetch: typeof globalThis.fetch;
	runId: number | string;
	instanceId?: string | null;
	now?: Date;
}

interface AdvanceWait {
	type: 'sleep' | 'approval';
	seconds?: number;
	until?: string;
	step_key?: string;
	timeout_seconds?: number;
}

export interface AdvanceResult {
	run_id: number;
	status: string;
	done: boolean;
	executed_step: { step_key: string; status: string; duration_ms: number | null } | null;
	wait: AdvanceWait | null;
}

function freshState(now: Date) {
	return {
		cursor: null,
		variables: { steps: {} },
		path: [],
		events: [],
		queued_jobs: [],
		messages: [],
		webhooks: [],
		approvals: {},
		wake_at: null,
		wake_for: null,
		pending_approval: null,
		attempts: {},
		steps_executed: 0,
		deadline_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
	};
}

function result(
	run,
	status,
	{ done = false, executedStep = null, wait = null } = {}
): AdvanceResult {
	return {
		run_id: Number(run.id),
		status,
		done,
		executed_step: executedStep,
		wait,
	};
}

function secondsUntil(iso, now: Date) {
	return Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / 1000));
}

function findEntryNode(nodes) {
	return (
		nodes.find((node) => node.id === 'start' && node.type === 'trigger') ||
		nodes.find((node) => node.type === 'trigger') ||
		nodes[0] ||
		null
	);
}

function executedKeysFromState(state, extraKey = null) {
	const keys = new Set((state.path || []).map((entry) => String(entry.step_key)));
	if (extraKey) keys.add(String(extraKey));
	return keys;
}

async function finalizeRun(db, run, state, status, { error = null, startedMsAgo = null } = {}) {
	await markUnreachedStepsAsSkipped(db, run, executedKeysFromState(state));
	await updateSuperadminWorkflowRun(db, run.id, {
		status,
		completed_at: nowSql(),
		duration_ms: startedMsAgo,
		error_message: error,
		state_json: state,
		result_json: {
			mode: 'graph_runtime',
			status,
			...(error ? { error } : {}),
			executed_steps: state.path,
			events: state.events,
			queued_jobs: state.queued_jobs,
			messages: state.messages,
			webhooks: state.webhooks,
			variables: state.variables,
		},
	});
}

function runDurationMs(run, now: Date) {
	if (!run.started_at) return null;
	const started = new Date(String(run.started_at).replace(' ', 'T') + 'Z').getTime();
	return Number.isFinite(started) ? Math.max(0, now.getTime() - started) : null;
}

/**
 * Load the graph definition a run should execute: the pinned template version
 * snapshot when available, else the live template. Returns a template-shaped
 * object (id, canvas_json, legacy_job_name, ...).
 */
async function loadPinnedTemplate(db, run) {
	if (run.template_version) {
		const snapshot = await getTemplateVersion(db, run.template_id, run.template_version);
		if (snapshot) {
			return { ...snapshot, id: run.template_id, published_version: snapshot.version };
		}
	}
	return getSuperadminWorkflowTemplate(db, run.template_id);
}

/**
 * Advance a run by at most one node. See module docs for the contract.
 */
export async function advanceSuperadminWorkflowRun({
	db,
	platform,
	fetch,
	runId,
	instanceId = null,
	now = new Date(),
}: AdvanceArgs): Promise<AdvanceResult | null> {
	const run = await getSuperadminWorkflowRun(db, runId);
	if (!run) return null;

	if (TERMINAL_STATUSES.has(run.status)) {
		return result(run, run.status, { done: true });
	}

	if (instanceId && !run.workflow_instance_id) {
		await updateSuperadminWorkflowRun(db, run.id, { workflow_instance_id: instanceId });
	}

	const template = await loadPinnedTemplate(db, run);
	if (!template) {
		await updateSuperadminWorkflowRun(db, run.id, {
			status: 'failed',
			completed_at: nowSql(),
			error_message: 'Workflow template not found',
		});
		return result(run, 'failed', { done: true });
	}

	const nodes = template.canvas_json?.nodes || [];

	// Node-less templates bridge to a named legacy /api/cron job in one call.
	if (nodes.length === 0) {
		if (template.legacy_job_name) {
			await executeLegacyBridgeRun({ db, platform, fetch, template, run });
			const finished = await getSuperadminWorkflowRun(db, run.id);
			return result(finished || run, finished?.status || 'completed', { done: true });
		}
		await updateSuperadminWorkflowRun(db, run.id, {
			status: 'completed',
			completed_at: nowSql(),
			duration_ms: 0,
			result_json: {
				mode: 'graph_runtime',
				summary: 'No nodes configured',
				executed_steps: [],
			},
		});
		return result(run, 'completed', { done: true });
	}

	// Runs created before durable execution have no state; the legacy inline
	// runtime owns them. Never re-execute their steps here.
	let state = run.state_json;
	if (!state || typeof state !== 'object') {
		if (run.status === 'queued') {
			state = freshState(now);
		} else {
			return result(run, run.status, { done: true });
		}
	}

	// Deadline guard: poison-fail runs that outlived their budget.
	if (state.deadline_at && now.getTime() > new Date(state.deadline_at).getTime()) {
		await finalizeRun(db, run, state, 'failed', {
			error: 'Workflow exceeded max run duration',
			startedMsAgo: runDurationMs(run, now),
		});
		return result(run, 'failed', { done: true });
	}

	// Sleeping and not yet due: idempotent replay of the wait instruction.
	if (state.wake_at && new Date(state.wake_at).getTime() > now.getTime()) {
		if (run.status !== 'sleeping') {
			await updateSuperadminWorkflowRun(db, run.id, {
				status: 'sleeping',
				state_json: state,
			});
		}
		return result(run, 'sleeping', {
			wait: {
				type: 'sleep',
				seconds: secondsUntil(state.wake_at, now),
				until: state.wake_at,
			},
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const nodesById = new Map<string, any>(nodes.map((node) => [String(node.id), node]));
	const runInput = asObject(run.input_json);

	// Pending approval gate.
	if (state.pending_approval) {
		const gate = state.pending_approval;
		const recorded = state.approvals?.[gate.step_key];
		let decision = recorded?.decision ? String(recorded.decision) : null;

		if (!decision && gate.timeout_at && now.getTime() >= new Date(gate.timeout_at).getTime()) {
			decision = String(gate.timeout_route || 'rejected');
			state.approvals = {
				...(state.approvals || {}),
				[gate.step_key]: { decision, decided_by: 'timeout', decided_at: now.toISOString() },
			};
		}

		if (!decision) {
			if (run.status !== 'waiting_approval') {
				await updateSuperadminWorkflowRun(db, run.id, {
					status: 'waiting_approval',
					state_json: state,
				});
			}
			return result(run, 'waiting_approval', {
				wait: {
					type: 'approval',
					step_key: gate.step_key,
					timeout_seconds: gate.timeout_at ? secondsUntil(gate.timeout_at, now) : null,
				},
			});
		}

		// Decision available: resolve the approval node and route onward.
		const node = nodesById.get(String(gate.step_key));
		await updateSuperadminWorkflowRunStep(db, run.id, gate.step_key, {
			status: 'completed',
			completed_at: nowSql(),
			duration_ms: gate.requested_at
				? Math.max(0, now.getTime() - new Date(gate.requested_at).getTime())
				: null,
			output_json: {
				decision,
				decided_by: state.approvals?.[gate.step_key]?.decided_by || null,
				timeout_route: gate.timeout_route || 'rejected',
			},
		});
		state.path.push({ step_key: gate.step_key, type: 'approval', route: decision });
		state.pending_approval = null;
		state.steps_executed = (state.steps_executed || 0) + 1;

		const nextEdge = node ? selectNextEdge(template, node, decision) : null;
		state.cursor = nextEdge ? String(nextEdge.target) : null;

		if (!state.cursor) {
			await finalizeRun(db, run, state, 'completed', {
				startedMsAgo: runDurationMs(run, now),
			});
			return result(run, 'completed', {
				done: true,
				executedStep: { step_key: gate.step_key, status: 'completed', duration_ms: null },
			});
		}

		await updateSuperadminWorkflowRun(db, run.id, { status: 'running', state_json: state });
		return result(run, 'running', {
			executedStep: { step_key: gate.step_key, status: 'completed', duration_ms: null },
		});
	}

	// First call: resolve the entry node and start the run.
	if (!state.cursor) {
		const entry = findEntryNode(nodes);
		if (!entry) {
			await finalizeRun(db, run, state, 'completed', { startedMsAgo: 0 });
			return result(run, 'completed', { done: true });
		}
		state.cursor = String(entry.id);
		if (run.status === 'queued' || !run.started_at) {
			await updateSuperadminWorkflowRun(db, run.id, {
				status: 'running',
				started_at: run.started_at || nowSql(),
				state_json: state,
			});
			run.started_at = run.started_at || nowSql();
		}
	}

	// Step budget guard.
	if ((state.steps_executed || 0) >= MAX_STEPS) {
		await finalizeRun(db, run, state, 'failed', {
			error: 'Workflow exceeded max execution steps',
			startedMsAgo: runDurationMs(run, now),
		});
		return result(run, 'failed', { done: true });
	}

	const currentNode = nodesById.get(String(state.cursor));
	if (!currentNode) {
		await finalizeRun(db, run, state, 'failed', {
			error: `Workflow node not found: ${state.cursor}`,
			startedMsAgo: runDurationMs(run, now),
		});
		return result(run, 'failed', { done: true });
	}

	const stepKey = String(currentNode.id);
	const stepStartMs = now.getTime();

	const runtime = {
		db,
		fetch,
		run,
		template,
		node: currentNode,
		input: runInput,
		variables: state.variables,
		events: state.events,
		queued_jobs: state.queued_jobs,
		messages: state.messages,
		webhooks: state.webhooks,
		nowIso: now.toISOString(),
	};

	try {
		let route = 'next';
		let output = {};

		if (currentNode.type === 'trigger') {
			route = 'start';
			output = {
				trigger_source: currentNode?.data?.source || run.trigger_source,
				trigger_schedule: currentNode?.data?.schedule || null,
			};
			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'completed',
				started_at: nowSql(),
				completed_at: nowSql(),
				duration_ms: 0,
				output_json: output,
			});
		} else if (currentNode.type === 'branch') {
			const branch = evaluateBranchNode(currentNode, runtime);
			route = branch.route;
			output = { branch };
			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'completed',
				started_at: nowSql(),
				completed_at: nowSql(),
				duration_ms: 0,
				output_json: output,
			});
		} else if (currentNode.type === 'approval') {
			// Pre-recorded decisions (UI run panel / auto_approve) resolve
			// immediately; otherwise the run pauses on a real approval gate.
			const preRecorded = String(asObject(runInput.approvals)[stepKey] || '')
				.trim()
				.toLowerCase();
			const autoApprove =
				runInput.auto_approve === true || currentNode?.data?.requiresConfirmation === false;

			if (['approved', 'rejected'].includes(preRecorded) || autoApprove) {
				const decision = ['approved', 'rejected'].includes(preRecorded)
					? preRecorded
					: 'approved';
				route = decision;
				output = {
					decision,
					source: autoApprove && !preRecorded ? 'auto_approve' : 'input',
				};
				await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
					status: 'completed',
					started_at: nowSql(),
					completed_at: nowSql(),
					duration_ms: 0,
					output_json: output,
				});
			} else {
				const timeoutHours = Math.max(
					1,
					Math.min(
						24 * 14,
						Number(currentNode?.data?.timeout_hours) || DEFAULT_APPROVAL_TIMEOUT_HOURS
					)
				);
				const timeoutAt = new Date(
					now.getTime() + timeoutHours * 3600 * 1000
				).toISOString();
				state.pending_approval = {
					step_key: stepKey,
					requested_at: now.toISOString(),
					timeout_at: timeoutAt,
					timeout_route:
						String(currentNode?.data?.timeout_route || 'rejected').trim() || 'rejected',
				};
				await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
					status: 'waiting',
					started_at: nowSql(),
					input_json: {
						node: { id: stepKey, type: 'approval', title: currentNode.title },
					},
				});
				await updateSuperadminWorkflowRun(db, run.id, {
					status: 'waiting_approval',
					state_json: state,
				});
				return result(run, 'waiting_approval', {
					wait: {
						type: 'approval',
						step_key: stepKey,
						timeout_seconds: timeoutHours * 3600,
					},
				});
			}
		} else {
			// Task node.
			const moduleConfig = normalizeTaskModuleConfig(currentNode.data || {});

			// Deferred timing: park the run until the planned time, then execute
			// the node on the wake-up call.
			const timingPlan = computeTaskTimingPlan(moduleConfig.timing, now);
			if (
				timingPlan.planned_for &&
				timingPlan.mode !== 'immediate' &&
				state.wake_for !== stepKey &&
				new Date(timingPlan.planned_for).getTime() > now.getTime() + 1000
			) {
				state.wake_at = timingPlan.planned_for;
				state.wake_for = stepKey;
				await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
					status: 'waiting',
					started_at: nowSql(),
					input_json: { timing: timingPlan },
				});
				await updateSuperadminWorkflowRun(db, run.id, {
					status: 'sleeping',
					state_json: state,
				});
				return result(run, 'sleeping', {
					wait: {
						type: 'sleep',
						seconds: secondsUntil(timingPlan.planned_for, now),
						until: timingPlan.planned_for,
					},
				});
			}
			if (state.wake_for === stepKey) {
				state.wake_at = null;
				state.wake_for = null;
			}

			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'running',
				started_at: nowSql(),
				error_message: null,
				input_json: {
					node: {
						id: currentNode.id,
						type: currentNode.type,
						title: currentNode.title,
						data: currentNode.data || {},
					},
					run_input: runInput,
					variables: state.variables,
				},
			});

			const botToken =
				(platform as { env?: Record<string, string> })?.env?.DISCORD_BOT_TOKEN ||
				(typeof process !== 'undefined' ? process.env?.DISCORD_BOT_TOKEN : undefined) ||
				null;

			const beforeActions = await runCustomActions(
				moduleConfig.custom_actions,
				'before',
				runtime
			);
			const resolvedData = resolveDataDeep(currentNode.data || {}, runtime);
			const operationKey = String(resolvedData.operation || '').trim();

			let operationResult = null;
			if (operationKey) {
				try {
					operationResult = await executeWorkflowOperation(operationKey, {
						db,
						platform,
						botToken,
						fetch,
						data: resolvedData,
						input: runInput,
						variables: state.variables,
						run,
						template,
					});
				} catch (error) {
					await runCustomActions(moduleConfig.custom_actions, 'on_failure', runtime, {
						swallowErrors: true,
					});
					if (error?.operationResult) {
						error.stepOutput = {
							operation: operationKey,
							result: error.operationResult,
						};
					}
					throw error;
				}
				state.variables.steps[stepKey] = operationResult;
			}

			const afterActions = await runCustomActions(
				moduleConfig.custom_actions,
				'after',
				runtime
			);
			const successActions = await runCustomActions(
				moduleConfig.custom_actions,
				'on_success',
				runtime
			);

			output = {
				operation: operationKey || null,
				result: operationResult,
				queue_key: resolvedData.queue_key || null,
				retry_policy: resolvedData.retry_policy || null,
				timeout_seconds: resolvedData.timeout_seconds || null,
				batch_size: resolvedData.batch_size || null,
				legacy_job_bridge: resolvedData.legacyJob || null,
				module: {
					key: moduleConfig.module_key || null,
					name: moduleConfig.module_name || null,
				},
				timing: timingPlan,
				custom_actions: {
					before: beforeActions,
					after: afterActions,
					on_success: successActions,
				},
			};
			route = 'next';

			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'completed',
				completed_at: nowSql(),
				duration_ms: Date.now() - stepStartMs,
				output_json: output,
			});
		}

		// Node executed: record path, clear retry counter, route to next node.
		state.path.push({ step_key: stepKey, type: currentNode.type, route });
		state.steps_executed = (state.steps_executed || 0) + 1;
		if (state.attempts?.[stepKey]) delete state.attempts[stepKey];

		const executedStep = {
			step_key: stepKey,
			status: 'completed',
			duration_ms: Date.now() - stepStartMs,
		};

		const nextEdge = selectNextEdge(template, currentNode, route);
		state.cursor = nextEdge ? String(nextEdge.target) : null;

		if (!state.cursor) {
			await finalizeRun(db, run, state, 'completed', {
				startedMsAgo: runDurationMs(run, now),
			});
			return result(run, 'completed', { done: true, executedStep });
		}

		await updateSuperadminWorkflowRun(db, run.id, { status: 'running', state_json: state });
		return result(run, 'running', { executedStep });
	} catch (error) {
		const message = error?.message || String(error);
		const attempts = (state.attempts?.[stepKey] || 0) + 1;
		state.attempts = { ...(state.attempts || {}), [stepKey]: attempts };

		const retryLimit = Math.max(
			0,
			Math.min(10, Number(currentNode?.data?.retry_policy?.limit ?? DEFAULT_RETRY_LIMIT))
		);

		if (attempts < retryLimit) {
			// Durable backoff: park the run; the driver sleeps and retries.
			const delaySeconds = RETRY_BASE_DELAY_SECONDS * 2 ** (attempts - 1);
			state.wake_at = new Date(now.getTime() + delaySeconds * 1000).toISOString();
			state.wake_for = stepKey;
			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'retrying',
				error_message: message,
				output_json: error?.stepOutput || null,
			});
			await updateSuperadminWorkflowRun(db, run.id, {
				status: 'sleeping',
				state_json: state,
			});
			return result(run, 'sleeping', {
				executedStep: {
					step_key: stepKey,
					status: 'retrying',
					duration_ms: Date.now() - stepStartMs,
				},
				wait: { type: 'sleep', seconds: delaySeconds, until: state.wake_at },
			});
		}

		await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
			status: 'failed',
			completed_at: nowSql(),
			duration_ms: Date.now() - stepStartMs,
			error_message: message,
			output_json: error?.stepOutput || null,
		});
		state.path.push({ step_key: stepKey, type: currentNode.type, route: 'failed' });
		await finalizeRun(db, run, state, 'failed', {
			error: message,
			startedMsAgo: runDurationMs(run, now),
		});
		return result(run, 'failed', {
			done: true,
			executedStep: {
				step_key: stepKey,
				status: 'failed',
				duration_ms: Date.now() - stepStartMs,
			},
		});
	}
}

interface DriveOptions {
	maxIterations?: number;
	/** Sleeps at or below this many seconds are awaited inline; longer sleeps
	 * park the run (the dispatch watchdog re-enqueues it). */
	inlineSleepCapSeconds?: number;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Drive a run to completion (or an approval/long-sleep park) in-process.
 * Dev/queueless fallback and test harness for the advance loop.
 */
export async function driveSuperadminWorkflowRunInline(
	{ db, platform = undefined, fetch, runId }: Omit<AdvanceArgs, 'instanceId' | 'now'>,
	{
		maxIterations = 600,
		inlineSleepCapSeconds = 30,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	}: DriveOptions = {}
): Promise<AdvanceResult | null> {
	let last: AdvanceResult | null = null;

	for (let i = 0; i < maxIterations; i += 1) {
		last = await advanceSuperadminWorkflowRun({ db, platform, fetch, runId });
		if (!last || last.done) return last;
		if (last.wait?.type === 'approval') return last;
		if (last.wait?.type === 'sleep') {
			const seconds = Number(last.wait.seconds) || 0;
			if (seconds > inlineSleepCapSeconds) return last;
			await sleep(seconds * 1000);
		}
	}
	return last;
}
