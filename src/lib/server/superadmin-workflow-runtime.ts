/**
 * Superadmin workflow execution runtime.
 *
 * Walks a template's canvas graph (trigger / task / branch / approval nodes),
 * executes each task node's registered operation for real (see
 * $lib/server/superadmin-workflow-operations.js), runs custom actions, and
 * records run/step state in D1.
 *
 * Used by both the manual runs endpoint and the cron dispatcher, so a
 * workflow behaves identically whether an operator clicks "Run" or the
 * scheduler fires it.
 */

import {
	getSuperadminWorkflowRun,
	updateSuperadminWorkflowRun,
	updateSuperadminWorkflowRunStep,
} from '$lib/db/superadmin-workflows.js';
import { executeWorkflowOperation } from '$lib/server/superadmin-workflow-operations.js';

export function nowSql() {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function asObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value;
}

export function normalizeTaskModuleConfig(nodeData) {
	const defaults = {
		module_key: '',
		module_name: '',
		timing: {
			mode: 'immediate',
			delay_minutes: 5,
			daily_time_utc: '09:00',
			cron_expression: '',
		},
		custom_actions: [],
	};

	const source = asObject(nodeData?.module_config);
	const timingSource = asObject(source.timing);
	const customActions = Array.isArray(source.custom_actions) ? source.custom_actions : [];

	return {
		module_key: String(source.module_key || ''),
		module_name: String(source.module_name || ''),
		timing: {
			mode: ['immediate', 'delay_minutes', 'daily_time_utc', 'cron'].includes(
				timingSource.mode
			)
				? timingSource.mode
				: defaults.timing.mode,
			delay_minutes: Math.max(
				1,
				Math.min(10080, Number(timingSource.delay_minutes) || defaults.timing.delay_minutes)
			),
			daily_time_utc: /^\d{2}:\d{2}$/.test(String(timingSource.daily_time_utc || ''))
				? String(timingSource.daily_time_utc)
				: defaults.timing.daily_time_utc,
			cron_expression: String(timingSource.cron_expression || ''),
		},
		custom_actions: customActions.map((action, index) => ({
			id: String(action?.id || `action-${index + 1}`),
			type: String(action?.type || 'set_variable'),
			name: String(action?.name || ''),
			key: String(action?.key || ''),
			value: action?.value == null ? '' : String(action.value),
			when: String(action?.when || 'after'),
			enabled: action?.enabled !== false,
		})),
	};
}

function getPathValue(source, path) {
	if (!path) return undefined;
	const segments = String(path)
		.split('.')
		.map((part) => part.trim())
		.filter(Boolean);
	let current = source;
	for (const segment of segments) {
		if (current == null) return undefined;
		current = current[segment];
	}
	return current;
}

function tokenValue(token, runtime) {
	const trimmed = String(token || '').trim();
	if (!trimmed) return '';

	if (trimmed === 'now') return runtime.nowIso;
	if (trimmed === 'run.id') return runtime.run.id;
	if (trimmed === 'run.template_id') return runtime.template.id;

	if (trimmed.startsWith('input.')) return getPathValue(runtime.input, trimmed.slice(6));
	if (trimmed.startsWith('variables.')) return getPathValue(runtime.variables, trimmed.slice(10));
	if (trimmed.startsWith('node.')) return getPathValue(runtime.node, trimmed.slice(5));

	return getPathValue(runtime.variables, trimmed);
}

function resolveTemplateValue(value, runtime) {
	if (typeof value !== 'string') return value;
	return value.replace(/\{([^}]+)\}/g, (_, token) => {
		const resolved = tokenValue(token, runtime);
		return resolved == null ? '' : String(resolved);
	});
}

/**
 * Deep-resolve {token} placeholders in node data so operations receive
 * runtime values (e.g. command: "echo {variables.guilds_found}").
 */
export function resolveDataDeep(value, runtime, depth = 0) {
	if (depth > 6) return value;
	if (typeof value === 'string') return resolveTemplateValue(value, runtime);
	if (Array.isArray(value)) return value.map((item) => resolveDataDeep(item, runtime, depth + 1));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, entry] of Object.entries(value)) {
			out[key] = resolveDataDeep(entry, runtime, depth + 1);
		}
		return out;
	}
	return value;
}

function parseLiteral(value) {
	const raw = String(value || '').trim();
	if (!raw) return raw;
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	if (!Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}
	return raw;
}

export function computeTaskTimingPlan(timing, nowDate = new Date()) {
	const mode = String(timing?.mode || 'immediate');
	if (mode === 'delay_minutes') {
		const delayMinutes = Math.max(1, Math.min(10080, Number(timing?.delay_minutes) || 5));
		const planned = new Date(nowDate.getTime() + delayMinutes * 60000);
		return {
			mode,
			delay_minutes: delayMinutes,
			planned_for: planned.toISOString(),
		};
	}

	if (mode === 'daily_time_utc') {
		const value = /^\d{2}:\d{2}$/.test(String(timing?.daily_time_utc || ''))
			? String(timing.daily_time_utc)
			: '09:00';
		const [hourRaw, minuteRaw] = value.split(':');
		const hour = Math.max(0, Math.min(23, Number(hourRaw) || 9));
		const minute = Math.max(0, Math.min(59, Number(minuteRaw) || 0));
		const planned = new Date(nowDate);
		planned.setUTCHours(hour, minute, 0, 0);
		if (planned.getTime() <= nowDate.getTime()) {
			planned.setUTCDate(planned.getUTCDate() + 1);
		}
		return {
			mode,
			daily_time_utc: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
			planned_for: planned.toISOString(),
		};
	}

	if (mode === 'cron') {
		return {
			mode,
			cron_expression: String(timing?.cron_expression || '').trim(),
			planned_for: null,
		};
	}

	return {
		mode: 'immediate',
		planned_for: nowDate.toISOString(),
	};
}

function normalizeOperand(value, runtime) {
	const resolved = resolveTemplateValue(value == null ? '' : String(value), runtime);
	return parseLiteral(resolved);
}

export function evaluateBranchNode(node, runtime) {
	const conditionMode = String(node?.data?.condition_mode || 'expression');
	if (conditionMode === 'rule') {
		const left = normalizeOperand(node?.data?.left_operand, runtime);
		const right = normalizeOperand(node?.data?.right_operand, runtime);
		const operator = String(node?.data?.operator || 'equals');

		let matched = false;
		if (operator === 'equals') matched = left === right;
		else if (operator === 'not_equals') matched = left !== right;
		else if (operator === 'contains')
			matched = String(left || '').includes(String(right || ''));
		else if (operator === 'starts_with')
			matched = String(left || '').startsWith(String(right || ''));
		else if (operator === 'ends_with')
			matched = String(left || '').endsWith(String(right || ''));
		else if (operator === 'gt') matched = Number(left) > Number(right);
		else if (operator === 'gte') matched = Number(left) >= Number(right);
		else if (operator === 'lt') matched = Number(left) < Number(right);
		else if (operator === 'lte') matched = Number(left) <= Number(right);

		return {
			matched,
			route: matched ? 'true' : 'false',
			details: {
				mode: 'rule',
				left,
				operator,
				right,
			},
		};
	}

	const expression = resolveTemplateValue(String(node?.data?.condition || '').trim(), runtime)
		.trim()
		.toLowerCase();
	const matched = ['true', '1', 'yes', 'y', 'on'].includes(expression);
	return {
		matched,
		route: matched ? 'true' : 'false',
		details: {
			mode: 'expression',
			expression,
		},
	};
}

export function selectNextEdge(template, node, route) {
	const edges = (template?.canvas_json?.edges || []).filter((edge) => edge.source === node.id);
	if (edges.length === 0) return null;
	const preferredRoute = String(route || '').trim();

	if (preferredRoute) {
		const byHandle = edges.find(
			(edge) => String(edge.source_handle || '').trim() === preferredRoute
		);
		if (byHandle) return byHandle;
		const byLabel = edges.find(
			(edge) =>
				String(edge.label || '')
					.trim()
					.toLowerCase() === preferredRoute.toLowerCase()
		);
		if (byLabel) return byLabel;
	}

	return edges[0];
}

async function executeCustomAction(action, stage, runtime) {
	if (!action?.enabled) return null;
	if (String(action.when || 'after') !== stage) return null;

	const resolvedName = resolveTemplateValue(action.name || '', runtime);
	const resolvedKey = resolveTemplateValue(action.key || '', runtime);
	const resolvedValueRaw = resolveTemplateValue(action.value || '', runtime);
	const resolvedValue = parseLiteral(resolvedValueRaw);

	if (action.type === 'set_variable') {
		const variableKey = String(resolvedKey || resolvedName || '').trim();
		if (!variableKey) throw new Error('set_variable action requires a key or name');
		runtime.variables[variableKey] = resolvedValue;
		return {
			id: action.id,
			type: action.type,
			when: stage,
			status: 'completed',
			key: variableKey,
			value: resolvedValue,
		};
	}

	if (action.type === 'emit_event') {
		const payload = {
			name: String(resolvedName || 'workflow.event'),
			key: String(resolvedKey || ''),
			value: resolvedValue,
			node_id: runtime.node.id,
			created_at: runtime.nowIso,
		};
		runtime.events.push(payload);
		return {
			id: action.id,
			type: action.type,
			when: stage,
			status: 'completed',
			event: payload,
		};
	}

	if (action.type === 'queue_job') {
		const payload = {
			job: String(resolvedName || resolvedKey || 'unnamed'),
			payload: resolvedValue,
			node_id: runtime.node.id,
			created_at: runtime.nowIso,
		};
		runtime.queued_jobs.push(payload);
		return {
			id: action.id,
			type: action.type,
			when: stage,
			status: 'completed',
			queued_job: payload,
		};
	}

	if (action.type === 'send_message') {
		const message = {
			channel: String(resolvedKey || ''),
			content: String(resolvedValueRaw || ''),
			node_id: runtime.node.id,
			created_at: runtime.nowIso,
		};
		runtime.messages.push(message);
		return { id: action.id, type: action.type, when: stage, status: 'completed', message };
	}

	if (action.type === 'call_webhook') {
		const url = String(
			(typeof resolvedValue === 'string' && /^https?:\/\//i.test(resolvedValue)
				? resolvedValue
				: resolvedKey) || ''
		).trim();
		if (!url) throw new Error('call_webhook action requires a valid URL');

		const payload = {
			source: 'superadmin_workflow_module_action',
			run_id: runtime.run.id,
			template_id: runtime.template.id,
			node_id: runtime.node.id,
			action_id: action.id,
			action_name: resolvedName || null,
			key: resolvedKey || null,
			value: resolvedValue,
			input: runtime.input,
			variables: runtime.variables,
			stage,
			at: runtime.nowIso,
		};

		const response = await runtime.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		const result = {
			url,
			status: response.status,
			ok: response.ok,
		};
		runtime.webhooks.push(result);

		if (!response.ok) {
			throw new Error(`Webhook returned HTTP ${response.status}`);
		}

		return {
			id: action.id,
			type: action.type,
			when: stage,
			status: 'completed',
			webhook: result,
		};
	}

	throw new Error(`Unsupported custom action type: ${action.type}`);
}

export async function runCustomActions(
	actions,
	stage,
	runtime,
	options: { swallowErrors?: boolean } = {}
) {
	const swallowErrors = options.swallowErrors === true;
	const results = [];
	for (const action of actions || []) {
		if (!action || action.enabled === false || String(action.when || 'after') !== stage)
			continue;
		try {
			const result = await executeCustomAction(action, stage, runtime);
			if (result) results.push(result);
		} catch (error) {
			const failed = {
				id: action.id,
				type: action.type,
				when: stage,
				status: 'failed',
				error: error?.message || String(error),
			};
			results.push(failed);
			if (!swallowErrors) {
				throw new Error(failed.error);
			}
		}
	}
	return results;
}

export async function markUnreachedStepsAsSkipped(db, run, executedStepKeys) {
	const pending = (run?.steps || []).filter((step) => !executedStepKeys.has(step.step_key));
	const completedAt = nowSql();
	for (const step of pending) {
		await updateSuperadminWorkflowRunStep(db, run.id, step.step_key, {
			status: 'skipped',
			completed_at: completedAt,
			output_json: {
				skipped_reason: 'No execution path reached this step',
			},
			duration_ms: 0,
		});
	}
}

export async function executeWorkflowGraphRuntime({
	db,
	platform,
	fetch,
	template,
	run,
	inputJson,
}) {
	const startedAt = nowSql();
	const runtimeStart = Date.now();
	const botToken =
		platform?.env?.DISCORD_BOT_TOKEN ||
		(typeof process !== 'undefined' ? process.env?.DISCORD_BOT_TOKEN : undefined) ||
		null;

	await updateSuperadminWorkflowRun(db, run.id, {
		status: 'running',
		started_at: startedAt,
		result_json: {
			mode: 'graph_runtime',
			status: 'running',
		},
	});

	const nodes = template?.canvas_json?.nodes || [];
	if (nodes.length === 0) {
		await updateSuperadminWorkflowRun(db, run.id, {
			status: 'completed',
			completed_at: nowSql(),
			duration_ms: Date.now() - runtimeStart,
			result_json: {
				mode: 'graph_runtime',
				summary: 'No nodes configured',
				executed_steps: [],
			},
		});
		return;
	}

	const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
	const triggerNode =
		nodes.find((node) => node.id === 'start' && node.type === 'trigger') ||
		nodes.find((node) => node.type === 'trigger') ||
		nodes[0];

	const runInput = asObject(inputJson);
	const approvals = asObject(runInput.approvals);

	const executionState = {
		variables: { steps: {} },
		events: [],
		queued_jobs: [],
		messages: [],
		webhooks: [],
		path: [],
	};

	const executedStepKeys = new Set();
	let currentNode = triggerNode;
	let guardCounter = 0;
	const maxSteps = 500;

	while (currentNode && guardCounter < maxSteps) {
		guardCounter += 1;
		const stepStartedAt = nowSql();
		const stepStartMs = Date.now();
		const stepKey = String(currentNode.id);

		await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
			status: 'running',
			started_at: stepStartedAt,
			error_message: null,
			input_json: {
				node: {
					id: currentNode.id,
					type: currentNode.type,
					title: currentNode.title,
					data: currentNode.data || {},
				},
				run_input: runInput,
				variables: executionState.variables,
			},
		});

		const runtime = {
			db,
			fetch,
			run,
			template,
			node: currentNode,
			input: runInput,
			variables: executionState.variables,
			events: executionState.events,
			queued_jobs: executionState.queued_jobs,
			messages: executionState.messages,
			webhooks: executionState.webhooks,
			nowIso: new Date().toISOString(),
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
			} else if (currentNode.type === 'branch') {
				const result = evaluateBranchNode(currentNode, runtime);
				route = result.route;
				output = {
					branch: result,
				};
			} else if (currentNode.type === 'approval') {
				const requestedDecision = String(approvals[stepKey] || '')
					.trim()
					.toLowerCase();
				const timeoutRoute =
					String(currentNode?.data?.timeout_route || 'rejected').trim() || 'rejected';
				let decision = requestedDecision;
				if (!['approved', 'rejected'].includes(decision)) {
					const autoApprove =
						runInput.auto_approve === true ||
						currentNode?.data?.requiresConfirmation === false;
					decision = autoApprove ? 'approved' : timeoutRoute;
				}
				route = decision;
				output = {
					decision,
					timeout_route: timeoutRoute,
				};
			} else {
				const moduleConfig = normalizeTaskModuleConfig(currentNode.data || {});
				const beforeActions = await runCustomActions(
					moduleConfig.custom_actions,
					'before',
					runtime
				);
				const timingPlan = computeTaskTimingPlan(moduleConfig.timing, new Date());

				const resolvedData = resolveDataDeep(currentNode.data || {}, runtime);
				const operationKey = String(resolvedData.operation || '').trim();

				// Execute the node's registered operation — this is where the actual
				// work happens (stats aggregation, runner jobs, HTTP calls, …).
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
							variables: executionState.variables,
							run,
							template,
						});
					} catch (error) {
						// Surface partial results, give on_failure hooks a chance, then
						// let the step fail.
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
					executionState.variables.steps[stepKey] = operationResult;
				}

				const coreOutput = {
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
				};

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
					...coreOutput,
					custom_actions: {
						before: beforeActions,
						after: afterActions,
						on_success: successActions,
					},
				};
				route = 'next';
			}

			const completedAt = nowSql();
			const durationMs = Date.now() - stepStartMs;
			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'completed',
				completed_at: completedAt,
				duration_ms: durationMs,
				output_json: output,
			});

			executionState.path.push({
				step_key: stepKey,
				type: currentNode.type,
				route,
			});
			executedStepKeys.add(stepKey);

			const nextEdge = selectNextEdge(template, currentNode, route);
			if (!nextEdge) {
				currentNode = null;
			} else {
				currentNode = nodesById.get(String(nextEdge.target)) || null;
			}
		} catch (error) {
			const completedAt = nowSql();
			const durationMs = Date.now() - stepStartMs;

			await updateSuperadminWorkflowRunStep(db, run.id, stepKey, {
				status: 'failed',
				completed_at: completedAt,
				duration_ms: durationMs,
				error_message: error?.message || String(error),
				output_json: error?.stepOutput || null,
			});

			executedStepKeys.add(stepKey);
			await markUnreachedStepsAsSkipped(db, run, executedStepKeys);

			await updateSuperadminWorkflowRun(db, run.id, {
				status: 'failed',
				completed_at: completedAt,
				duration_ms: Date.now() - runtimeStart,
				error_message: error?.message || 'Workflow runtime failed',
				result_json: {
					mode: 'graph_runtime',
					status: 'failed',
					failed_step: stepKey,
					error: error?.message || String(error),
					path: executionState.path,
					events: executionState.events,
					queued_jobs: executionState.queued_jobs,
					messages: executionState.messages,
					webhooks: executionState.webhooks,
					variables: executionState.variables,
				},
			});

			return;
		}
	}

	if (guardCounter >= maxSteps) {
		await updateSuperadminWorkflowRun(db, run.id, {
			status: 'failed',
			completed_at: nowSql(),
			duration_ms: Date.now() - runtimeStart,
			error_message: 'Workflow exceeded max execution steps',
			result_json: {
				mode: 'graph_runtime',
				status: 'failed',
				error: 'Max execution steps reached',
				max_steps: maxSteps,
				path: executionState.path,
			},
		});
		await markUnreachedStepsAsSkipped(db, run, executedStepKeys);
		return;
	}

	await markUnreachedStepsAsSkipped(db, run, executedStepKeys);

	await updateSuperadminWorkflowRun(db, run.id, {
		status: 'completed',
		completed_at: nowSql(),
		duration_ms: Date.now() - runtimeStart,
		error_message: null,
		result_json: {
			mode: 'graph_runtime',
			status: 'completed',
			executed_steps: executionState.path,
			events: executionState.events,
			queued_jobs: executionState.queued_jobs,
			messages: executionState.messages,
			webhooks: executionState.webhooks,
			variables: executionState.variables,
		},
	});
}

/**
 * Bridge a whole run to a named legacy /api/cron job. Only used for templates
 * with no canvas nodes; templates with a graph execute natively.
 */
export async function executeLegacyBridgeRun({ db, platform, fetch, template, run }) {
	const startedAt = nowSql();
	await updateSuperadminWorkflowRun(db, run.id, {
		status: 'running',
		started_at: startedAt,
		result_json: {
			bridgeMode: 'legacy_cron',
			jobName: template.legacy_job_name,
		},
	});

	const secret =
		platform?.env?.CRON_SECRET ||
		platform?.env?.INTERNAL_API_KEY ||
		(typeof process !== 'undefined'
			? process.env?.CRON_SECRET || process.env?.INTERNAL_API_KEY
			: undefined);
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (secret) headers.Authorization = `Bearer ${secret}`;

	const startTime = Date.now();
	const cronResponse = await fetch('/api/cron', {
		method: 'POST',
		headers,
		body: JSON.stringify({ jobName: template.legacy_job_name }),
	});
	const cronBody = await cronResponse.json().catch(() => ({}));

	await updateSuperadminWorkflowRun(db, run.id, {
		status: cronResponse.ok ? 'completed' : 'failed',
		completed_at: nowSql(),
		duration_ms: Date.now() - startTime,
		error_message: cronResponse.ok ? null : cronBody.error || 'Legacy cron bridge failed',
		result_json: cronResponse.ok
			? {
					bridgeMode: 'legacy_cron',
					jobName: template.legacy_job_name,
					cron: cronBody,
				}
			: {
					bridgeMode: 'legacy_cron',
					jobName: template.legacy_job_name,
					error: cronBody.error || 'Legacy cron bridge failed',
				},
	});
}

/**
 * Execute a freshly created run for a template: graph runtime when the canvas
 * has nodes (operations execute for real), legacy bridge for node-less
 * templates that still point at a legacy job name.
 */
export async function executeSuperadminWorkflowRun({
	db,
	platform,
	fetch,
	template,
	run,
	inputJson,
}) {
	const nodes = template?.canvas_json?.nodes || [];

	if (nodes.length > 0) {
		await executeWorkflowGraphRuntime({ db, platform, fetch, template, run, inputJson });
	} else if (template?.legacy_job_name) {
		await executeLegacyBridgeRun({ db, platform, fetch, template, run });
	} else {
		await executeWorkflowGraphRuntime({ db, platform, fetch, template, run, inputJson });
	}

	return getSuperadminWorkflowRun(db, run.id);
}
