<script lang="ts">
	import { RUN_STATUSES, statusBadgeClass } from './workflow-ui.js';

	let { runs = [], templates = [], onopenrun } = $props();

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

<div class="run-filters">
	<input type="text" placeholder="Search run id, status, error…" bind:value={runSearch} />
	<select bind:value={runStatusFilter}>
		<option value="all">All statuses</option>
		{#each RUN_STATUSES as status (status)}
			<option value={status}>{status.replace('_', ' ')}</option>
		{/each}
	</select>
</div>
<div class="run-list">
	{#each filteredRuns as run (run.id)}
		<button class="run-row" onclick={() => onopenrun?.(run)}>
			<span class="status-badge {statusBadgeClass(run.status)}">{run.status}</span>
			<span class="run-template-name">{templateName(run.template_id)}</span>
			<span class="run-meta">
				#{run.id} · {run.trigger_source} · {run.started_at || run.created_at}
			</span>
			{#if run.error_message}<span class="run-error">{run.error_message}</span>{/if}
		</button>
	{:else}
		<p class="empty-state">No runs yet. Run a workflow from the templates list above.</p>
	{/each}
</div>

<style>
	.run-filters {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.run-filters input {
		flex: 1;
	}
	.run-filters input,
	.run-filters select {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: inherit;
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
		flex-wrap: wrap;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: none;
		color: inherit;
		padding: 0.5rem 0.6rem;
		cursor: pointer;
		text-align: left;
		font-size: 0.85rem;
	}
	.run-row:hover {
		border-color: var(--color-primary);
	}
	.status-badge {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
	}
	.badge-success {
		color: #16a34a;
	}
	.badge-danger {
		color: #dc2626;
	}
	.badge-info {
		color: var(--color-primary);
	}
	.badge-warning {
		color: #d97706;
	}
	.run-template-name {
		font-weight: 600;
	}
	.run-meta {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	.run-error {
		color: #dc2626;
		font-size: 0.75rem;
		width: 100%;
	}
	.empty-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
	}
</style>
