<script lang="ts">
	import ScheduleEditor from './ScheduleEditor.svelte';
	import StepCard from './StepCard.svelte';
	import { JOB_TYPE_SUGGESTIONS } from './workflow-ui.js';
	import { createStep } from '$lib/superadmin-workflow-graph.js';

	let {
		draft = $bindable(),
		isNew = false,
		publishedVersion = null,
		operationTemplates = [],
		operationCatalog = [],
		runnerTokens = [],
		runnerTokensLoading = false,
		saving = false,
		saveError = null,
		onsave,
		onclose,
		onapplypreset,
		onneedrunnertokens,
	} = $props();

	let showAdvanced = $state(false);
	let showJson = $state(false);
	let changeNote = $state('');
	let startFromPresetSlug = $state('');

	function addStep(type: 'task' | 'approval' | 'branch') {
		const label =
			type === 'task' ? 'New Task' : type === 'approval' ? 'Approval Gate' : 'Branch';
		const step = createStep(type, label);
		if (draft.flatMode) {
			// Flat steps carry an explicit "next" route for tasks.
			if (type === 'task') step.routes = { next: null };
			// Wire the previous end-of-list step to the new one when obvious.
			const last = draft.steps.at(-1);
			if (last && 'next' in last.routes && last.routes.next == null) {
				last.routes.next = step.id;
			}
		}
		draft.steps.push(step);
		if (type === 'task') onneedrunnertokens?.();
	}

	function removeStep(id: string) {
		draft.steps = draft.steps.filter((s) => s.id !== id);
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
		// Never move anything above the trigger in flat mode.
		if (draft.flatMode && target === 0 && draft.steps[0]?.type === 'trigger') return;
		const [step] = draft.steps.splice(index, 1);
		draft.steps.splice(target, 0, step);
	}

	function otherSteps(currentId: string) {
		return draft.steps.filter((s) => s.id !== currentId && s.type !== 'trigger');
	}

	function save() {
		onsave?.(changeNote.trim() || undefined);
		changeNote = '';
	}
</script>

<div class="editor">
	{#if isNew && operationTemplates.length > 0}
		<label class="field">
			<span>Start from a preset (optional)</span>
			<select
				bind:value={startFromPresetSlug}
				onchange={() => onapplypreset?.(startFromPresetSlug)}
			>
				<option value="">Blank workflow</option>
				{#each operationTemplates as preset (preset.slug)}
					<option value={preset.slug}>{preset.name}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if draft.flatMode}
		<div class="info-banner">
			This workflow's graph doesn't fit the simple top-to-bottom editor
			{#if draft.flatModeReason}({draft.flatModeReason}){/if} — showing the full routing editor
			instead. Every step's "go to" targets are editable.
		</div>
	{/if}

	<div class="field-grid">
		<label class="field">
			<span>Name</span>
			<input type="text" bind:value={draft.name} placeholder="e.g. Nightly Report" />
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

	<ScheduleEditor bind:draft />

	<button class="btn-link" onclick={() => (showAdvanced = !showAdvanced)}
		>{showAdvanced ? '▾' : '▸'} Advanced</button
	>
	{#if showAdvanced}
		<div class="field-grid">
			<label class="field">
				<span>Slug {draft.is_builtin ? '(locked for built-ins)' : ''}</span>
				<input
					type="text"
					bind:value={draft.slug}
					disabled={draft.is_builtin}
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
			{#if draft.flatMode}
				Every step routes explicitly — "End workflow" stops the run on that path.
			{:else}
				Runs top to bottom. Approval and branch steps can redirect to any other step instead
				of just falling through.
			{/if}
		</p>

		{#each draft.steps as step, index (step.id)}
			<StepCard
				bind:step={draft.steps[index]}
				{index}
				total={draft.steps.length}
				otherSteps={otherSteps(step.id)}
				{operationCatalog}
				{runnerTokens}
				{runnerTokensLoading}
				flatMode={draft.flatMode}
				onmove={moveStep}
				onremove={removeStep}
				onneedrunnertokens={() => onneedrunnertokens?.()}
			/>
		{:else}
			<p class="empty-state">No steps yet — add one below.</p>
		{/each}

		<div class="add-step-row">
			<button class="btn btn-secondary btn-sm" onclick={() => addStep('task')}>+ Task</button>
			<button class="btn btn-secondary btn-sm" onclick={() => addStep('approval')}
				>+ Approval</button
			>
			<button class="btn btn-secondary btn-sm" onclick={() => addStep('branch')}
				>+ Branch</button
			>
		</div>
	</div>

	<button class="btn-link" onclick={() => (showJson = !showJson)}
		>{showJson ? '▾' : '▸'} Inspect graph JSON</button
	>
	{#if showJson}
		<pre class="raw-json">{JSON.stringify(draft.rawCanvasPreview ?? '', null, 2)}</pre>
	{/if}

	{#if saveError}<div class="error-banner">{saveError}</div>{/if}
	<div class="editor-actions">
		<label class="field change-note">
			<span>
				Change note (optional{#if !isNew && publishedVersion}
					— saving definition changes publishes v{publishedVersion + 1}{/if})
			</span>
			<input type="text" bind:value={changeNote} placeholder="What changed and why" />
		</label>
		<div class="editor-buttons">
			<button class="btn btn-primary" disabled={saving} onclick={save}
				>{saving ? 'Saving…' : 'Save changes'}</button
			>
			<button class="btn btn-secondary" onclick={() => onclose?.()}>Close</button>
		</div>
	</div>
</div>

<datalist id="job-type-suggestions">
	{#each JOB_TYPE_SUGGESTIONS as t (t)}<option value={t}></option>{/each}
</datalist>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.info-banner {
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-md);
		padding: 0.6rem 0.75rem;
		font-size: 0.82rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
	}
	.field span {
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.field input,
	.field select,
	.field textarea {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: inherit;
		font-family: inherit;
	}
	.field input:disabled {
		opacity: 0.55;
	}
	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
	}
	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		padding: 0;
		font-size: 0.85rem;
		text-align: left;
	}
	.steps-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.steps-section h3 {
		margin: 0;
		font-size: 0.95rem;
	}
	.hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
	.add-step-row {
		display: flex;
		gap: 0.5rem;
	}
	.raw-json {
		font-size: 0.72rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-sm);
		padding: 0.6rem;
		overflow-x: auto;
		max-height: 320px;
	}
	.error-banner {
		border: 1px solid #dc2626;
		color: #dc2626;
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
	}
	.editor-actions {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.change-note input {
		width: 100%;
	}
	.editor-buttons {
		display: flex;
		gap: 0.5rem;
	}
	.empty-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
</style>
