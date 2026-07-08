<script lang="ts">
	import {
		parseCanvasJson,
		parseWorkflowFlat,
		compileCanvasJson,
		compileWorkflowFlat,
	} from '$lib/superadmin-workflow-graph.js';
	import {
		cronFromSchedule,
		scheduleFromCron,
		slugify,
	} from '$lib/components/superadmin-workflows/workflow-ui.js';
	import TemplateList from '$lib/components/superadmin-workflows/TemplateList.svelte';
	import TemplateEditor from '$lib/components/superadmin-workflows/TemplateEditor.svelte';
	import VersionHistoryPanel from '$lib/components/superadmin-workflows/VersionHistoryPanel.svelte';
	import RunHistoryPanel from '$lib/components/superadmin-workflows/RunHistoryPanel.svelte';
	import RunDetailDrawer from '$lib/components/superadmin-workflows/RunDetailDrawer.svelte';
	import { toast } from '$lib/toast.svelte.js';

	const { data } = $props();

	let templates = $state(data.templates || []);
	let runs = $state(data.runs || []);
	const operationTemplates = data.operationTemplates || [];
	const operationCatalog = data.operationCatalog || [];

	// --- Draft construction ---
	function blankDraft() {
		return {
			id: null,
			name: '',
			slug: '',
			description: '',
			category: 'operations',
			enabled: true,
			is_builtin: false,
			execution_backend: 'cloudflare_workflows',
			legacy_job_name: '',
			...scheduleFromCron('manual', ''),
			triggerData: {},
			steps: [] as any[],
			flatMode: false,
			flatModeReason: '',
			rawCanvasPreview: null as any,
		};
	}

	function draftFromTemplateLike(t) {
		const sched = scheduleFromCron(t.schedule_type, t.cron_expression);
		const base = {
			...blankDraft(),
			...sched,
			id: t.id ?? null,
			name: t.name || '',
			slug: t.slug || '',
			description: t.description || '',
			category: t.category || 'operations',
			enabled: t.enabled !== false,
			is_builtin: t.is_builtin === true,
			execution_backend: t.execution_backend || 'cloudflare_workflows',
			legacy_job_name: t.legacy_job_name || '',
			rawCanvasPreview: t.canvas_json ?? null,
		};

		const parsed = parseCanvasJson(t.canvas_json);
		if (parsed.valid === true) {
			return { ...base, triggerData: parsed.triggerData, steps: parsed.steps };
		}

		// Graphs the simple chain editor can't represent get the fully general
		// routing editor instead of the old read-only raw JSON view.
		return {
			...base,
			flatMode: true,
			flatModeReason: parsed.valid === false ? parsed.reason : '',
			steps: parseWorkflowFlat(t.canvas_json),
		};
	}

	let selectedId = $state<number | 'new' | null>(null);
	let draft = $state(blankDraft());
	let saving = $state(false);
	let saveError = $state(null);
	let versionsTemplateId = $state<number | null>(null);
	let openRunId = $state<number | null>(null);
	let openRunTemplateName = $state('');
	let runningId = $state<number | null>(null);

	const selectedTemplate = $derived(
		typeof selectedId === 'number' ? templates.find((t) => t.id === selectedId) : null
	);

	function selectTemplate(template) {
		selectedId = template.id;
		draft = draftFromTemplateLike(template);
		saveError = null;
	}

	function startNewWorkflow() {
		selectedId = 'new';
		draft = blankDraft();
		saveError = null;
		void ensureRunnerTokensLoaded();
	}

	function applyPreset(slug) {
		const preset = operationTemplates.find((p) => p.slug === slug);
		if (!preset) return;
		draft = { ...draftFromTemplateLike(preset), id: null, slug: '', is_builtin: false };
	}

	function closeEditor() {
		selectedId = null;
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

	// --- API orchestration ---
	async function refresh() {
		const res = await fetch('/api/superadmin/workflows?limit=100&runLimit=25');
		const result = await res.json();
		if (res.ok) {
			templates = result.templates || [];
			runs = result.runs || [];
		}
	}

	function compileDraftCanvas() {
		if (draft.flatMode) {
			// Keep the trigger step's schedule metadata in sync.
			const trigger = draft.steps.find((s) => s.type === 'trigger');
			if (trigger) {
				trigger.data = {
					...trigger.data,
					source: draft.scheduleMode === 'manual' ? 'operator' : 'gateway-cron',
					schedule: draft.scheduleMode === 'manual' ? null : cronFromSchedule(draft),
				};
			}
			return compileWorkflowFlat(draft.steps);
		}
		const triggerData = {
			...draft.triggerData,
			source: draft.scheduleMode === 'manual' ? 'operator' : 'gateway-cron',
			schedule: draft.scheduleMode === 'manual' ? null : cronFromSchedule(draft),
		};
		return compileCanvasJson(triggerData, draft.steps);
	}

	async function saveDraft(changeNote?: string) {
		if (!draft.name.trim()) {
			saveError = 'Name is required.';
			return;
		}
		saving = true;
		saveError = null;
		try {
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
				canvas_json: compileDraftCanvas(),
				change_note: changeNote,
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

			toast.success(`Saved — live version is v${result.template.published_version}`);
			await refresh();
			selectTemplate(result.template);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save workflow.';
		} finally {
			saving = false;
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
		const body = await res.json().catch(() => ({}));
		if (res.ok) {
			await refresh();
			if (selectedId === template.id) closeEditor();
		} else {
			toast.error(body.error || 'Failed to archive workflow');
		}
	}

	async function resetBuiltin(template) {
		if (
			!confirm(
				`Reset "${template.name}" to its built-in definition? Your customized history stays revertible.`
			)
		)
			return;
		const res = await fetch(`/api/superadmin/workflows/${template.id}/reset-builtin`, {
			method: 'POST',
		});
		const body = await res.json();
		if (res.ok) {
			toast.success(`Reset to built-in (v${body.template.published_version})`);
			await refresh();
			if (selectedId === template.id) selectTemplate(body.template);
		} else {
			toast.error(body.error || 'Failed to reset workflow');
		}
	}

	async function runTemplate(template, approvals: Record<string, string>) {
		runningId = template.id;
		try {
			const input_json = Object.keys(approvals).length > 0 ? { approvals } : undefined;
			const res = await fetch(`/api/superadmin/workflows/${template.id}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ execute_now: true, input_json }),
			});
			const body = await res.json();
			if (res.ok && body.run) {
				toast.success(
					body.execution === 'workflow'
						? 'Run queued on Cloudflare Workflows'
						: 'Run started'
				);
				openRunId = body.run.id;
				openRunTemplateName = template.name;
			} else {
				toast.error(body.error || 'Failed to start run');
			}
			await refresh();
		} finally {
			runningId = null;
		}
	}

	function openRun(run) {
		openRunId = run.id;
		openRunTemplateName =
			templates.find((t) => t.id === run.template_id)?.name || `Workflow #${run.template_id}`;
	}

	function onVersionReverted(template) {
		void refresh().then(() => {
			if (selectedId === template.id) selectTemplate(template);
		});
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
				Scheduled and on-demand operations, executed durably on Cloudflare Workflows. Every
				edit is versioned — revert any workflow to any past version.
			</p>
		</div>
		<div class="header-stats">
			<div><strong>{templates.length}</strong><span>templates</span></div>
			<div>
				<strong>{templates.filter((t) => t.enabled).length}</strong><span>enabled</span>
			</div>
			<div>
				<strong>{templates.filter((t) => t.is_builtin).length}</strong><span>built-in</span>
			</div>
		</div>
	</header>

	<section class="card">
		<div class="card-header">
			<h2>Templates</h2>
			<button class="btn btn-primary btn-sm" onclick={startNewWorkflow}>+ New Workflow</button
			>
		</div>
		<TemplateList
			{templates}
			{selectedId}
			{runningId}
			onselect={selectTemplate}
			ontoggle={toggleEnabled}
			onrun={runTemplate}
			onarchive={archiveTemplate}
			onresetbuiltin={resetBuiltin}
			onshowversions={(template) =>
				(versionsTemplateId = versionsTemplateId === template.id ? null : template.id)}
		/>
		{#if versionsTemplateId !== null}
			{@const versionsTemplate = templates.find((t) => t.id === versionsTemplateId)}
			{#if versionsTemplate}
				<div class="versions-section">
					<div class="card-header">
						<h2>Version history — {versionsTemplate.name}</h2>
						<button
							class="btn btn-secondary btn-sm"
							onclick={() => (versionsTemplateId = null)}>Close</button
						>
					</div>
					<VersionHistoryPanel
						templateId={versionsTemplate.id}
						publishedVersion={versionsTemplate.published_version}
						onreverted={onVersionReverted}
					/>
				</div>
			{/if}
		{/if}
	</section>

	{#if selectedId !== null}
		<section class="card editor-card">
			<div class="card-header">
				<h2>{selectedId === 'new' ? 'New workflow' : `Edit: ${draft.name}`}</h2>
				{#if selectedTemplate?.is_builtin}
					<span class="builtin-note"
						>Built-in — archive is disabled, edits are versioned</span
					>
				{/if}
			</div>
			<TemplateEditor
				bind:draft
				isNew={selectedId === 'new'}
				publishedVersion={selectedTemplate?.published_version ?? null}
				{operationTemplates}
				{operationCatalog}
				{runnerTokens}
				{runnerTokensLoading}
				{saving}
				{saveError}
				onsave={saveDraft}
				onclose={closeEditor}
				onapplypreset={applyPreset}
				onneedrunnertokens={ensureRunnerTokensLoaded}
			/>
		</section>
	{/if}

	<section class="card">
		<div class="card-header">
			<h2>Recent runs</h2>
		</div>
		<RunHistoryPanel {runs} {templates} onopenrun={openRun} />
	</section>
</div>

{#if openRunId !== null}
	<RunDetailDrawer
		runId={openRunId}
		templateName={openRunTemplateName}
		onclose={() => (openRunId = null)}
		onchanged={refresh}
	/>
{/if}

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
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.card-header h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.versions-section {
		margin-top: 1rem;
		border-top: 1px solid var(--color-border);
		padding-top: 1rem;
	}
	.builtin-note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	:global(.workflows-page .btn) {
		cursor: pointer;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		background: var(--color-surface);
		color: inherit;
	}
	:global(.workflows-page .btn-sm) {
		padding: 0.3rem 0.65rem;
		font-size: 0.78rem;
	}
	:global(.workflows-page .btn-primary) {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-button-text);
	}
	:global(.workflows-page .btn-danger) {
		color: #dc2626;
		border-color: #dc2626;
	}
	:global(.workflows-page .btn:disabled) {
		opacity: 0.55;
		cursor: default;
	}
</style>
