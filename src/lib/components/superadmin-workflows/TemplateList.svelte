<script lang="ts">
	import { scheduleFromCron, scheduleLabel } from './workflow-ui.js';
	import { parseCanvasJson } from '$lib/superadmin-workflow-graph.js';

	const {
		templates = [],
		selectedId = null,
		runningId = null,
		onselect,
		ontoggle,
		onrun,
		onarchive,
		onresetbuiltin,
		onshowversions,
	} = $props();

	// Pre-run approval choices (for approval gates the operator wants to
	// pre-answer instead of pausing the run).
	let runPanelTemplateId = $state<number | null>(null);
	let runApprovalChoices = $state<Record<string, string>>({});

	function approvalStepsFor(template) {
		const parsed = parseCanvasJson(template.canvas_json);
		if (!parsed.valid) return [];
		return parsed.steps.filter((s) => s.type === 'approval');
	}

	function openRunPanel(template) {
		const approvalSteps = approvalStepsFor(template);
		if (approvalSteps.length === 0) {
			onrun?.(template, {});
			return;
		}
		runPanelTemplateId = template.id;
		// "pause" = let the run stop at the gate for a live decision.
		runApprovalChoices = Object.fromEntries(approvalSteps.map((s) => [s.id, 'pause']));
	}

	function confirmRun(template) {
		const approvals = Object.fromEntries(
			Object.entries(runApprovalChoices).filter(
				([, v]) => v === 'approved' || v === 'rejected'
			)
		);
		onrun?.(template, approvals);
		runPanelTemplateId = null;
	}
</script>

<div class="template-list">
	{#each templates as template (template.id)}
		<div class="template-row" class:selected={selectedId === template.id}>
			<button class="template-main" onclick={() => onselect?.(template)}>
				<span class="template-name">
					{template.name}
					{#if template.is_builtin}<span class="builtin-badge">Built-in</span>{/if}
					<span class="version-chip">v{template.published_version}</span>
				</span>
				<span class="template-meta">{template.description || 'No description'}</span>
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
						onchange={() => ontoggle?.(template)}
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
				<button class="btn btn-secondary btn-sm" onclick={() => onshowversions?.(template)}
					>Versions</button
				>
				{#if template.is_builtin}
					<button
						class="btn btn-secondary btn-sm"
						onclick={() => onresetbuiltin?.(template)}>Reset to built-in</button
					>
				{:else}
					<button class="btn btn-danger btn-sm" onclick={() => onarchive?.(template)}
						>Archive</button
					>
				{/if}
			</div>
			{#if runPanelTemplateId === template.id}
				<div class="run-approval-panel">
					<p>
						This workflow has approval gates. Pre-answer them, or leave on "Pause" to
						decide live from the run detail view:
					</p>
					{#each approvalStepsFor(template) as step (step.id)}
						<label class="approval-choice">
							{step.title}
							<select bind:value={runApprovalChoices[step.id]}>
								<option value="pause">Pause for live decision</option>
								<option value="approved">Pre-approve</option>
								<option value="rejected">Pre-reject</option>
							</select>
						</label>
					{/each}
					<div class="run-approval-actions">
						<button class="btn btn-primary btn-sm" onclick={() => confirmRun(template)}
							>Run</button
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
			No workflows yet. Create one or wait for the dispatcher to seed the built-ins.
		</p>
	{/each}
</div>

<style>
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
		color: inherit;
	}
	.template-name {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.builtin-badge {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
		border-radius: 999px;
		padding: 0.08rem 0.4rem;
	}
	.version-chip {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.08rem 0.4rem;
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
		font-size: 0.85rem;
	}
	.run-approval-panel p {
		margin: 0 0 0.5rem;
	}
	.approval-choice {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0;
	}
	.run-approval-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.empty-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
	}
</style>
