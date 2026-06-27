<script lang="ts">
	import {
		parseCanvasJson,
		compileCanvasJson,
		createStep,
		routesForType,
		type WorkflowStep,
		type ParsedWorkflow,
	} from '$lib/superadmin-workflow-graph.js';

	type EditableStep = WorkflowStep & { _advancedOpen?: boolean };

	function parseFailed(p: ParsedWorkflow): p is { valid: false; reason: string; raw: any } {
		return p.valid === false;
	}

	const { data } = $props();

	let templates = $state(data.templates || []);
	let runs = $state(data.runs || []);
	const operationTemplates = data.operationTemplates || [];
	const operationCatalog = data.operationCatalog || [];

	const WEEKDAY_OPTIONS = [
		{ id: 0, label: 'Sunday' },
		{ id: 1, label: 'Monday' },
		{ id: 2, label: 'Tuesday' },
		{ id: 3, label: 'Wednesday' },
		{ id: 4, label: 'Thursday' },
		{ id: 5, label: 'Friday' },
		{ id: 6, label: 'Saturday' },
	];
	const BRANCH_OPERATORS = [
		{ id: 'equals', label: 'equals' },
		{ id: 'not_equals', label: 'does not equal' },
		{ id: 'contains', label: 'contains' },
		{ id: 'starts_with', label: 'starts with' },
		{ id: 'ends_with', label: 'ends with' },
		{ id: 'gt', label: 'greater than' },
		{ id: 'gte', label: 'greater or equal' },
		{ id: 'lt', label: 'less than' },
		{ id: 'lte', label: 'less or equal' },
	];
	const JOB_TYPE_SUGGESTIONS = ['shell_command', 'system_profile', 'screenshot_capture', 'dm'];

	function pad2(value) {
		return String(value).padStart(2, '0');
	}
	function clampNumber(value, min, max, fallback) {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		return Math.max(min, Math.min(max, Math.trunc(n)));
	}
	function normalizeWeekday(value, fallback = 1) {
		const n = Number(value);
		return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
	}

	// --- Schedule cadence <-> cron (ported as-is from the previous editor) ---
	function cronFromSchedule(s) {
		const mode = s.scheduleMode;
		const minute = clampNumber(s.minute, 0, 59, 0);
		const hour = clampNumber(s.hour, 0, 23, 9);
		const everyHours = clampNumber(s.everyHours, 1, 23, 6);
		const weekday = normalizeWeekday(s.weekday, 1);
		const monthday = clampNumber(s.monthday, 1, 31, 1);
		if (mode === 'hourly') return `${minute} * * * *`;
		if (mode === 'every_n_hours') return `${minute} */${everyHours} * * *`;
		if (mode === 'daily') return `${minute} ${hour} * * *`;
		if (mode === 'weekly') return `${minute} ${hour} * * ${weekday}`;
		if (mode === 'monthly') return `${minute} ${hour} ${monthday} * *`;
		return '';
	}

	function scheduleFromCron(scheduleType, cronExpression) {
		const base = {
			scheduleMode: 'manual',
			minute: 0,
			hour: 9,
			everyHours: 6,
			weekday: 1,
			monthday: 1,
			unsupported: false,
		};
		const expression = String(cronExpression || '').trim();
		if (scheduleType !== 'cron' || !expression) return base;

		const parts = expression.split(/\s+/);
		if (parts.length !== 5) return { ...base, scheduleMode: 'daily', unsupported: true };

		const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;
		const minute = Number(minutePart);
		const hour = Number(hourPart);
		const dayOfMonth = Number(dayOfMonthPart);
		const dayOfWeek = Number(dayOfWeekPart);

		if (
			Number.isInteger(minute) &&
			hourPart === '*' &&
			dayOfMonthPart === '*' &&
			monthPart === '*' &&
			dayOfWeekPart === '*'
		) {
			return { ...base, scheduleMode: 'hourly', minute: clampNumber(minute, 0, 59, 0) };
		}
		const everyMatch = /^\*\/(\d{1,2})$/.exec(hourPart);
		if (
			Number.isInteger(minute) &&
			everyMatch &&
			dayOfMonthPart === '*' &&
			monthPart === '*' &&
			dayOfWeekPart === '*'
		) {
			return {
				...base,
				scheduleMode: 'every_n_hours',
				minute: clampNumber(minute, 0, 59, 0),
				everyHours: clampNumber(Number(everyMatch[1]), 1, 23, 6),
			};
		}
		if (
			Number.isInteger(minute) &&
			Number.isInteger(hour) &&
			dayOfMonthPart === '*' &&
			monthPart === '*' &&
			dayOfWeekPart === '*'
		) {
			return {
				...base,
				scheduleMode: 'daily',
				minute: clampNumber(minute, 0, 59, 0),
				hour: clampNumber(hour, 0, 23, 9),
			};
		}
		if (
			Number.isInteger(minute) &&
			Number.isInteger(hour) &&
			dayOfMonthPart === '*' &&
			monthPart === '*' &&
			Number.isInteger(dayOfWeek)
		) {
			return {
				...base,
				scheduleMode: 'weekly',
				minute: clampNumber(minute, 0, 59, 0),
				hour: clampNumber(hour, 0, 23, 9),
				weekday: normalizeWeekday(dayOfWeek, 1),
			};
		}
		if (
			Number.isInteger(minute) &&
			Number.isInteger(hour) &&
			Number.isInteger(dayOfMonth) &&
			monthPart === '*' &&
			dayOfWeekPart === '*'
		) {
			return {
				...base,
				scheduleMode: 'monthly',
				minute: clampNumber(minute, 0, 59, 0),
				hour: clampNumber(hour, 0, 23, 9),
				monthday: clampNumber(dayOfMonth, 1, 31, 1),
			};
		}
		return {
			...base,
			scheduleMode: 'daily',
			minute: Number.isInteger(minute) ? minute : 0,
			hour: Number.isInteger(hour) ? hour : 9,
			unsupported: true,
		};
	}

	function scheduleLabel(s) {
		const mode = s.scheduleMode;
		const timeLabel = `${pad2(clampNumber(s.hour, 0, 23, 9))}:${pad2(clampNumber(s.minute, 0, 59, 0))} UTC`;
		if (s.unsupported) return 'Legacy custom schedule';
		if (mode === 'hourly')
			return `Every hour at minute ${pad2(clampNumber(s.minute, 0, 59, 0))}`;
		if (mode === 'every_n_hours')
			return `Every ${clampNumber(s.everyHours, 1, 23, 6)} hours at minute ${pad2(clampNumber(s.minute, 0, 59, 0))}`;
		if (mode === 'daily') return `Daily at ${timeLabel}`;
		if (mode === 'weekly')
			return `Weekly on ${WEEKDAY_OPTIONS.find((o) => o.id === normalizeWeekday(s.weekday))?.label} at ${timeLabel}`;
		if (mode === 'monthly')
			return `Monthly on day ${clampNumber(s.monthday, 1, 31, 1)} at ${timeLabel}`;
		return 'Manual only';
	}

	// --- Draft construction ---
	function slugify(value) {
		return String(value || '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80);
	}

	function blankDraft() {
		return {
			id: null,
			name: '',
			slug: '',
			description: '',
			category: 'operations',
			enabled: true,
			execution_backend: 'cloudflare_workflows',
			legacy_job_name: '',
			...scheduleFromCron('manual', ''),
			triggerData: {},
			steps: [] as EditableStep[],
			invalid: false,
			invalidReason: '',
			rawCanvasJson: null as any,
		};
	}

	function draftFromTemplateLike(t) {
		const parsed = parseCanvasJson(t.canvas_json);
		const sched = scheduleFromCron(t.schedule_type, t.cron_expression);
		if (parseFailed(parsed)) {
			return {
				...blankDraft(),
				...sched,
				id: t.id ?? null,
				name: t.name || '',
				slug: t.slug || '',
				description: t.description || '',
				category: t.category || 'operations',
				enabled: t.enabled !== false,
				execution_backend: t.execution_backend || 'cloudflare_workflows',
				legacy_job_name: t.legacy_job_name || '',
				invalid: true,
				invalidReason: parsed.reason,
				rawCanvasJson:
					typeof t.canvas_json === 'string'
						? t.canvas_json
						: JSON.stringify(t.canvas_json, null, 2),
			};
		}
		return {
			id: t.id ?? null,
			name: t.name || '',
			slug: t.slug || '',
			description: t.description || '',
			category: t.category || 'operations',
			enabled: t.enabled !== false,
			execution_backend: t.execution_backend || 'cloudflare_workflows',
			legacy_job_name: t.legacy_job_name || '',
			...sched,
			triggerData: parsed.triggerData,
			steps: parsed.steps,
			invalid: false,
			invalidReason: '',
			rawCanvasJson: null,
		};
	}

	let selectedId = $state<number | 'new' | null>(null);
	let draft = $state(blankDraft());
	let startFromPresetSlug = $state('');
	let saving = $state(false);
	let saveError = $state(null);
	let showAdvanced = $state(false);

	function selectTemplate(template) {
		selectedId = template.id;
		draft = draftFromTemplateLike(template);
		saveError = null;
		showAdvanced = false;
	}

	function startNewWorkflow() {
		selectedId = 'new';
		draft = blankDraft();
		startFromPresetSlug = '';
		saveError = null;
		showAdvanced = false;
		ensureRunnerTokensLoaded();
	}

	function applyPreset(slug) {
		const preset = operationTemplates.find((p) => p.slug === slug);
		if (!preset) return;
		draft = { ...draftFromTemplateLike(preset), id: null, slug: '' };
	}

	function closeEditor() {
		selectedId = null;
	}

	// --- Step list editing ---
	function addStep(type: 'task' | 'approval' | 'branch') {
		const label =
			type === 'task' ? 'New Task' : type === 'approval' ? 'Approval Gate' : 'Branch';
		draft.steps.push(createStep(type, label));
		if (type === 'task') ensureRunnerTokensLoaded();
	}

	function removeStep(id: string) {
		draft.steps = draft.steps.filter((s) => s.id !== id);
		// Clear any dangling route references to the removed step.
		for (const step of draft.steps) {
			for (const routeName of Object.keys(step.routes)) {
				if (step.routes[routeName] === id) step.routes[routeName] = null;
			}
		}
	}

	function moveStep(id: string, direction: -1 | 1) {
		const index = draft.steps.findIndex((s) => s.id === id);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= draft.steps.length) return;
		const [step] = draft.steps.splice(index, 1);
		draft.steps.splice(target, 0, step);
	}

	function otherSteps(currentId: string) {
		return draft.steps.filter((s) => s.id !== currentId);
	}

	// --- Runner token picker ---
	let runnerTokens = $state([]);
	let runnerTokensLoaded = $state(false);
	let runnerTokensLoading = $state(false);

	async function ensureRunnerTokensLoaded() {
		if (runnerTokensLoaded || runnerTokensLoading) return;
		runnerTokensLoading = true;
		try {
			const res = await fetch('/api/superadmin/runners/tokens');
			const body = await res.json();
			if (res.ok) {
				runnerTokens = body.tokens || [];
				runnerTokensLoaded = true;
			}
		} catch {
			// picker just stays empty; the raw numeric field input is the fallback
		} finally {
			runnerTokensLoading = false;
		}
	}

	// --- Save ---
	async function saveDraft() {
		if (!draft.name.trim()) {
			saveError = 'Name is required.';
			return;
		}
		saving = true;
		saveError = null;
		try {
			const triggerData = {
				...draft.triggerData,
				source: draft.scheduleMode === 'manual' ? 'operator' : 'gateway-cron',
				schedule: draft.scheduleMode === 'manual' ? null : cronFromSchedule(draft),
			};
			const canvas_json = compileCanvasJson(triggerData, draft.steps);
			const body = {
				name: draft.name.trim(),
				slug: draft.slug.trim() || slugify(draft.name),
				description: draft.description.trim() || undefined,
				category: draft.category.trim() || 'operations',
				enabled: draft.enabled,
				execution_backend: draft.execution_backend,
				legacy_job_name: draft.legacy_job_name.trim() || undefined,
				schedule_type: draft.scheduleMode === 'manual' ? 'manual' : 'cron',
				cron_expression: draft.scheduleMode === 'manual' ? '' : cronFromSchedule(draft),
				canvas_json,
			};

			const res =
				selectedId === 'new'
					? await fetch('/api/superadmin/workflows', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body),
						})
					: await fetch(`/api/superadmin/workflows/${selectedId}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body),
						});

			const result = await res.json();
			if (!res.ok) {
				saveError = result.error || 'Failed to save workflow.';
				return;
			}

			await refresh();
			selectTemplate(result.template);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save workflow.';
		} finally {
			saving = false;
		}
	}

	async function refresh() {
		const res = await fetch('/api/superadmin/workflows?limit=100&runLimit=100');
		const result = await res.json();
		if (res.ok) {
			templates = result.templates || [];
			runs = result.runs || [];
		}
	}

	async function toggleEnabled(template) {
		const res = await fetch(`/api/superadmin/workflows/${template.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !template.enabled }),
		});
		if (res.ok) await refresh();
	}

	async function archiveTemplate(template) {
		if (
			!confirm(
				`Archive "${template.name}"? It can still be restored from the database if needed.`
			)
		)
			return;
		const res = await fetch(`/api/superadmin/workflows/${template.id}`, { method: 'DELETE' });
		if (res.ok) {
			await refresh();
			if (selectedId === template.id) closeEditor();
		}
	}

	// --- Run ---
	let runningId = $state<number | null>(null);
	let runApprovalChoices = $state<Record<string, 'approved' | 'rejected'>>({});
	let runPanelTemplateId = $state<number | null>(null);

	function approvalStepsFor(template) {
		const parsed = parseCanvasJson(template.canvas_json);
		if (!parsed.valid) return [];
		return parsed.steps.filter((s) => s.type === 'approval');
	}

	function openRunPanel(template) {
		const approvalSteps = approvalStepsFor(template);
		if (approvalSteps.length === 0) {
			void runTemplate(template, {});
			return;
		}
		runPanelTemplateId = template.id;
		runApprovalChoices = Object.fromEntries(approvalSteps.map((s) => [s.id, 'approved']));
	}

	async function runTemplate(template, approvals: Record<string, string>) {
		runningId = template.id;
		try {
			const input_json = Object.keys(approvals).length > 0 ? { approvals } : undefined;
			await fetch(`/api/superadmin/workflows/${template.id}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ execute_now: true, input_json }),
			});
			await refresh();
		} finally {
			runningId = null;
			runPanelTemplateId = null;
		}
	}

	function operationLabel(key) {
		return (
			operationCatalog.find((o) => o.key === key)?.description ||
			key ||
			'Choose an operation…'
		);
	}

	function statusBadgeClass(status) {
		if (status === 'completed') return 'badge-success';
		if (status === 'failed') return 'badge-danger';
		if (status === 'running' || status === 'queued') return 'badge-info';
		return 'badge-neutral';
	}

	let runSearch = $state('');
	let runStatusFilter = $state('all');
	const filteredRuns = $derived(
		runs.filter((r) => {
			if (runStatusFilter !== 'all' && r.status !== runStatusFilter) return false;
			if (!runSearch.trim()) return true;
			const haystack =
				`${r.id} ${r.status} ${r.trigger_source} ${r.error_message || ''}`.toLowerCase();
			return haystack.includes(runSearch.trim().toLowerCase());
		})
	);

	function templateName(templateId) {
		return templates.find((t) => t.id === templateId)?.name || `Workflow #${templateId}`;
	}
</script>

<svelte:head>
	<title>Workflows | Superadmin | SpaceBot</title>
</svelte:head>

<div class="workflows-page">
	<header class="page-header">
		<div>
			<span class="eyebrow">OPERATIONS</span>
			<h1>Workflows</h1>
			<p class="subtitle">
				The recurring jobs that used to be hardcoded cron — now editable templates you can
				run on demand.
			</p>
		</div>
		<div class="header-stats">
			<div><strong>{templates.length}</strong><span>templates</span></div>
			<div>
				<strong>{templates.filter((t) => t.enabled).length}</strong><span>enabled</span>
			</div>
		</div>
	</header>

	<section class="card">
		<div class="card-header">
			<h2>Templates</h2>
			<button class="btn btn-primary btn-sm" onclick={startNewWorkflow}>+ New Workflow</button
			>
		</div>
		<div class="template-list">
			{#each templates as template (template.id)}
				<div class="template-row" class:selected={selectedId === template.id}>
					<button class="template-main" onclick={() => selectTemplate(template)}>
						<span class="template-name">{template.name}</span>
						<span class="template-meta">{template.description || 'No description'}</span
						>
						<span class="template-schedule"
							>{scheduleLabel(
								scheduleFromCron(template.schedule_type, template.cron_expression)
							)}</span
						>
					</button>
					<div class="template-actions">
						<label class="toggle-inline">
							<input
								type="checkbox"
								checked={template.enabled}
								onchange={() => toggleEnabled(template)}
							/>
							{template.enabled ? 'Enabled' : 'Disabled'}
						</label>
						<button
							class="btn btn-secondary btn-sm"
							disabled={runningId === template.id}
							onclick={() => openRunPanel(template)}
						>
							{runningId === template.id ? 'Running…' : 'Run'}
						</button>
						<button
							class="btn btn-danger btn-sm"
							onclick={() => archiveTemplate(template)}>Archive</button
						>
					</div>
					{#if runPanelTemplateId === template.id}
						<div class="run-approval-panel">
							<p>
								This workflow has approval gates. Choose a decision for each before
								running:
							</p>
							{#each approvalStepsFor(template) as step (step.id)}
								<label class="approval-choice">
									{step.title}
									<select bind:value={runApprovalChoices[step.id]}>
										<option value="approved">Approve</option>
										<option value="rejected">Reject</option>
									</select>
								</label>
							{/each}
							<div class="run-approval-actions">
								<button
									class="btn btn-primary btn-sm"
									onclick={() => runTemplate(template, runApprovalChoices)}
									>Confirm &amp; Run</button
								>
								<button
									class="btn btn-secondary btn-sm"
									onclick={() => (runPanelTemplateId = null)}>Cancel</button
								>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<p class="empty-state">
					No workflows yet. Create one or wait for the dispatcher to seed the defaults.
				</p>
			{/each}
		</div>
	</section>

	{#if selectedId !== null}
		<section class="card editor-card">
			<div class="card-header">
				<h2>{selectedId === 'new' ? 'New workflow' : `Edit: ${draft.name}`}</h2>
				<button class="btn btn-secondary btn-sm" onclick={closeEditor}>Close</button>
			</div>

			{#if draft.invalid}
				<div class="warning-banner">
					<strong>This workflow's graph is too complex for the simple editor</strong>
					<p>
						{draft.invalidReason}. Showing the raw structure read-only — edit it
						directly via the API if needed.
					</p>
				</div>
				<pre class="raw-json">{draft.rawCanvasJson}</pre>
			{:else}
				{#if selectedId === 'new' && operationTemplates.length > 0}
					<label class="field">
						<span>Start from a preset (optional)</span>
						<select
							bind:value={startFromPresetSlug}
							onchange={() => applyPreset(startFromPresetSlug)}
						>
							<option value="">Blank workflow</option>
							{#each operationTemplates as preset}
								<option value={preset.slug}>{preset.name}</option>
							{/each}
						</select>
					</label>
				{/if}

				<div class="field-grid">
					<label class="field">
						<span>Name</span>
						<input
							type="text"
							bind:value={draft.name}
							placeholder="e.g. Nightly Report"
						/>
					</label>
					<label class="field">
						<span>Category</span>
						<input type="text" bind:value={draft.category} />
					</label>
				</div>
				<label class="field">
					<span>Description</span>
					<textarea bind:value={draft.description} rows="2"></textarea>
				</label>

				<fieldset class="schedule-builder">
					<legend>Schedule</legend>
					<label class="field">
						<span>Cadence</span>
						<select bind:value={draft.scheduleMode}>
							<option value="manual">Manual only</option>
							<option value="hourly">Hourly</option>
							<option value="every_n_hours">Every N hours</option>
							<option value="daily">Daily</option>
							<option value="weekly">Weekly</option>
							<option value="monthly">Monthly</option>
						</select>
					</label>
					{#if draft.scheduleMode !== 'manual'}
						<div class="field-grid">
							{#if draft.scheduleMode === 'every_n_hours'}
								<label class="field"
									><span>Every N hours</span><input
										type="number"
										min="1"
										max="23"
										bind:value={draft.everyHours}
									/></label
								>
							{/if}
							{#if draft.scheduleMode !== 'hourly' && draft.scheduleMode !== 'every_n_hours'}
								<label class="field"
									><span>Hour (UTC)</span><input
										type="number"
										min="0"
										max="23"
										bind:value={draft.hour}
									/></label
								>
							{/if}
							<label class="field"
								><span>Minute</span><input
									type="number"
									min="0"
									max="59"
									bind:value={draft.minute}
								/></label
							>
							{#if draft.scheduleMode === 'weekly'}
								<label class="field">
									<span>Day</span>
									<select bind:value={draft.weekday}>
										{#each WEEKDAY_OPTIONS as opt}<option value={opt.id}
												>{opt.label}</option
											>{/each}
									</select>
								</label>
							{/if}
							{#if draft.scheduleMode === 'monthly'}
								<label class="field"
									><span>Day of month</span><input
										type="number"
										min="1"
										max="31"
										bind:value={draft.monthday}
									/></label
								>
							{/if}
						</div>
					{/if}
					<p class="schedule-preview">{scheduleLabel(draft)}</p>
					<label class="toggle-inline">
						<input type="checkbox" bind:checked={draft.enabled} />
						Enabled
					</label>
				</fieldset>

				<button class="btn-link" onclick={() => (showAdvanced = !showAdvanced)}
					>{showAdvanced ? '▾' : '▸'} Advanced</button
				>
				{#if showAdvanced}
					<div class="field-grid">
						<label class="field">
							<span>Slug</span>
							<input
								type="text"
								bind:value={draft.slug}
								placeholder="auto-generated from name"
							/>
						</label>
						<label class="field">
							<span>Execution backend</span>
							<select bind:value={draft.execution_backend}>
								<option value="cloudflare_workflows">cloudflare_workflows</option>
								<option value="legacy_cron_bridge">legacy_cron_bridge</option>
								<option value="queue_orchestrator">queue_orchestrator</option>
							</select>
						</label>
						<label class="field">
							<span>Legacy job bridge</span>
							<input
								type="text"
								bind:value={draft.legacy_job_name}
								placeholder="e.g. daily_refresh"
							/>
						</label>
					</div>
				{/if}

				<div class="steps-section">
					<h3>Steps</h3>
					<p class="hint">
						Runs top to bottom. Approval and branch steps can redirect to any other step
						instead of just falling through.
					</p>

					{#each draft.steps as step, index (step.id)}
						<div class="step-card">
							<div class="step-card-header">
								<span class="step-index">{index + 1}</span>
								<span class="type-badge type-{step.type}">{step.type}</span>
								<input
									class="step-title"
									type="text"
									bind:value={step.title}
									placeholder="Step title"
								/>
								<div class="step-controls">
									<button
										class="icon-btn"
										disabled={index === 0}
										onclick={() => moveStep(step.id, -1)}
										title="Move up">↑</button
									>
									<button
										class="icon-btn"
										disabled={index === draft.steps.length - 1}
										onclick={() => moveStep(step.id, 1)}
										title="Move down">↓</button
									>
									<button
										class="icon-btn danger"
										onclick={() => removeStep(step.id)}
										title="Remove step">✕</button
									>
								</div>
							</div>

							{#if step.type === 'task'}
								<label class="field">
									<span>Operation</span>
									<select bind:value={step.data.operation}>
										<option value="">Choose an operation…</option>
										{#each operationCatalog as op}
											<option value={op.key}
												>{op.key}{op.destructive ? ' ⚠️ destructive' : ''} — {op.description}</option
											>
										{/each}
									</select>
								</label>

								{#if step.data.operation === 'local_runner_job'}
									<div class="runner-task-fields">
										<label class="field">
											<span>Runner token</span>
											<select
												bind:value={step.data.runner_token_id}
												onfocus={ensureRunnerTokensLoaded}
											>
												<option value={0}>Select a runner…</option>
												{#each runnerTokens as token}
													<option value={token.id}>
														{token.is_online ? '🟢' : '⚪'}
														{token.name} — {token.owner_display_name ||
															'unknown owner'}
													</option>
												{/each}
											</select>
											{#if runnerTokensLoading}<span class="field-note"
													>Loading runners…</span
												>{/if}
										</label>
										<div class="field-grid">
											<label class="field">
												<span>Job type</span>
												<input
													type="text"
													list="job-type-suggestions"
													bind:value={step.data.job_type}
													placeholder="shell_command"
												/>
											</label>
											<label class="field">
												<span>Wait timeout (seconds)</span>
												<input
													type="number"
													min="1"
													max="240"
													bind:value={step.data.wait_timeout_seconds}
													placeholder="90"
												/>
											</label>
										</div>
										{#if !step.data.job_type || step.data.job_type === 'shell_command'}
											<label class="field">
												<span>Command</span>
												<input
													type="text"
													bind:value={step.data.command}
													placeholder="uptime && df -h / | tail -1"
												/>
											</label>
										{/if}
										<label class="toggle-inline">
											<input
												type="checkbox"
												checked={step.data.wait_for_result !== false}
												onchange={(e) =>
													(step.data.wait_for_result =
														e.currentTarget.checked)}
											/>
											Wait for result before continuing
										</label>
									</div>
								{/if}

								<button
									class="btn-link"
									onclick={() => (step._advancedOpen = !step._advancedOpen)}
									>{step._advancedOpen ? '▾' : '▸'} Advanced</button
								>
								{#if step._advancedOpen}
									<label class="field">
										<span>Queue key</span>
										<input
											type="text"
											bind:value={step.data.queue_key}
											placeholder="ops.example.key"
										/>
									</label>
								{/if}
							{/if}

							{#if step.type === 'approval'}
								<div class="field-grid">
									<label class="field"
										><span>Approver role ID</span><input
											type="text"
											bind:value={step.data.approver_role_id}
										/></label
									>
									<label class="field"
										><span>Decision timeout (minutes)</span><input
											type="number"
											min="1"
											bind:value={step.data.decision_timeout_minutes}
										/></label
									>
								</div>
								<label class="field">
									<span>On timeout</span>
									<select bind:value={step.data.timeout_route}>
										<option value="rejected">Treat as rejected</option>
										<option value="approved">Treat as approved</option>
									</select>
								</label>
								<div class="route-grid">
									{#each routesForType('approval') as routeName}
										<label class="field">
											<span>If {routeName}, go to</span>
											<select bind:value={step.routes[routeName]}>
												<option value={null}>End workflow</option>
												{#each otherSteps(step.id) as target}
													<option value={target.id}
														>{target.title || target.id}</option
													>
												{/each}
											</select>
										</label>
									{/each}
								</div>
							{/if}

							{#if step.type === 'branch'}
								<div class="field-grid">
									<label class="field"
										><span>Left value</span><input
											type="text"
											bind:value={step.data.left_operand}
											placeholder="e.g. {'{'}{'{'}variables.count}}"
										/></label
									>
									<label class="field">
										<span>Operator</span>
										<select bind:value={step.data.operator}>
											{#each BRANCH_OPERATORS as op}<option value={op.id}
													>{op.label}</option
												>{/each}
										</select>
									</label>
									<label class="field"
										><span>Right value</span><input
											type="text"
											bind:value={step.data.right_operand}
										/></label
									>
								</div>
								<div class="route-grid">
									{#each routesForType('branch') as routeName}
										<label class="field">
											<span>If {routeName}, go to</span>
											<select bind:value={step.routes[routeName]}>
												<option value={null}>End workflow</option>
												{#each otherSteps(step.id) as target}
													<option value={target.id}
														>{target.title || target.id}</option
													>
												{/each}
											</select>
										</label>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<p class="empty-state">No steps yet — add one below.</p>
					{/each}

					<div class="add-step-row">
						<button class="btn btn-secondary btn-sm" onclick={() => addStep('task')}
							>+ Task</button
						>
						<button class="btn btn-secondary btn-sm" onclick={() => addStep('approval')}
							>+ Approval</button
						>
						<button class="btn btn-secondary btn-sm" onclick={() => addStep('branch')}
							>+ Branch</button
						>
					</div>
				</div>

				{#if saveError}<div class="error-banner">{saveError}</div>{/if}
				<div class="editor-actions">
					<button class="btn btn-primary" disabled={saving} onclick={saveDraft}
						>{saving ? 'Saving…' : 'Save changes'}</button
					>
				</div>
			{/if}
		</section>
	{/if}

	<section class="card">
		<div class="card-header">
			<h2>Recent runs</h2>
		</div>
		<div class="run-filters">
			<input type="text" placeholder="Search run id, status, error…" bind:value={runSearch} />
			<select bind:value={runStatusFilter}>
				<option value="all">All statuses</option>
				<option value="queued">Queued</option>
				<option value="running">Running</option>
				<option value="completed">Completed</option>
				<option value="failed">Failed</option>
			</select>
		</div>
		<div class="run-list">
			{#each filteredRuns as run (run.id)}
				<div class="run-row">
					<span class="status-badge {statusBadgeClass(run.status)}">{run.status}</span>
					<span class="run-template-name">{templateName(run.template_id)}</span>
					<span class="run-meta"
						>{run.trigger_source} · {run.started_at || run.created_at}</span
					>
					{#if run.error_message}<span class="run-error">{run.error_message}</span>{/if}
				</div>
			{:else}
				<p class="empty-state">
					No runs yet. Run a workflow from the templates list above.
				</p>
			{/each}
		</div>
	</section>
</div>

<datalist id="job-type-suggestions">
	{#each JOB_TYPE_SUGGESTIONS as t}<option value={t}></option>{/each}
</datalist>

<style>
	.workflows-page {
		max-width: 920px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--color-primary);
	}
	.page-header h1 {
		margin: 0.2rem 0;
	}
	.subtitle {
		color: var(--color-text-muted);
		margin: 0;
		max-width: 60ch;
	}
	.header-stats {
		display: flex;
		gap: 1.5rem;
	}
	.header-stats div {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.header-stats strong {
		font-size: 1.4rem;
	}
	.header-stats span {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}
	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.card-header h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.template-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.template-row {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem;
	}
	.template-row.selected {
		border-color: var(--color-primary);
	}
	.template-main {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		width: 100%;
		background: none;
		border: none;
		padding: 0.5rem;
		cursor: pointer;
		text-align: left;
	}
	.template-name {
		font-weight: 600;
	}
	.template-meta {
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}
	.template-schedule {
		font-size: 0.75rem;
		color: var(--color-primary);
	}
	.template-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		flex-wrap: wrap;
	}
	.toggle-inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}

	.run-approval-panel {
		margin: 0.5rem;
		padding: 0.75rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}
	.approval-choice {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin: 0.4rem 0;
	}
	.run-approval-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
	}
	.field span {
		font-weight: 500;
		color: var(--color-text-muted);
	}
	.field input,
	.field select,
	.field textarea {
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}
	.field-note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
	}

	.warning-banner {
		background: var(--color-warning-soft);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.raw-json {
		background: var(--color-surface-elevated);
		padding: 0.75rem;
		border-radius: var(--radius-md);
		overflow-x: auto;
		font-size: 0.8rem;
		max-height: 400px;
	}
	.error-banner {
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		padding: 0.6rem;
		margin: 0.5rem 0;
		font-size: 0.85rem;
	}

	.schedule-builder {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		margin: 0.75rem 0;
	}
	.schedule-builder legend {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}
	.schedule-preview {
		font-size: 0.85rem;
		color: var(--color-primary);
		margin: 0.25rem 0;
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		padding: 0.25rem 0;
		font-size: 0.85rem;
	}

	.steps-section {
		margin-top: 1rem;
	}
	.steps-section h3 {
		margin: 0 0 0.25rem;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0 0 0.75rem;
	}
	.step-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.step-card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.step-index {
		font-weight: 700;
		color: var(--color-text-muted);
		width: 1.2rem;
	}
	.type-badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		padding: 0.15rem 0.4rem;
		border-radius: 999px;
		background: var(--color-surface-elevated);
	}
	.type-badge.type-approval {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	.type-badge.type-branch {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.step-title {
		flex: 1;
		font-weight: 600;
		border: none;
		background: none;
		padding: 0.25rem;
	}
	.step-controls {
		display: flex;
		gap: 0.25rem;
	}
	.icon-btn {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		cursor: pointer;
	}
	.icon-btn.danger {
		color: var(--color-danger);
	}
	.icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.route-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-top: 0.5rem;
	}
	.runner-task-fields {
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		padding: 0.6rem;
		margin: 0.5rem 0;
	}
	.add-step-row {
		display: flex;
		gap: 0.5rem;
	}

	.editor-actions {
		margin-top: 1rem;
		display: flex;
		justify-content: flex-end;
	}
	.empty-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
	}

	.run-filters {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.run-filters input {
		flex: 1;
		padding: 0.4rem 0.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.run-filters select {
		padding: 0.4rem 0.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.run-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.run-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		flex-wrap: wrap;
		font-size: 0.85rem;
	}
	.run-template-name {
		font-weight: 600;
	}
	.run-meta {
		color: var(--color-text-muted);
		font-size: 0.78rem;
	}
	.run-error {
		color: var(--color-danger);
		font-size: 0.78rem;
	}
	.status-badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
	}
	.badge-success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.badge-danger {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}
	.badge-info {
		background: var(--color-info-soft);
		color: var(--color-info);
	}
	.badge-neutral {
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}
</style>
