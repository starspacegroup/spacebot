<script lang="ts">
	import { toast } from '$lib/toast.svelte.js';
	import { formatDuration, isTerminalRunStatus, statusBadgeClass } from './workflow-ui.js';

	const { runId, templateName = '', onclose, onchanged } = $props();

	let run = $state(null);
	let loading = $state(true);
	let acting = $state(false);
	const expandedSteps = $state<Record<string, boolean>>({});

	async function load() {
		try {
			const res = await fetch(`/api/superadmin/workflows/runs/${runId}`);
			const body = await res.json();
			if (res.ok) {
				run = body.run;
			}
		} finally {
			loading = false;
		}
	}

	// Poll while the run is active.
	$effect(() => {
		if (!runId) return;
		void load();
		const interval = setInterval(() => {
			if (run && isTerminalRunStatus(run.status)) return;
			void load();
		}, 3000);
		return () => clearInterval(interval);
	});

	const pendingApproval = $derived(
		run?.status === 'waiting_approval' ? run?.state_json?.pending_approval : null
	);

	async function decide(decision: 'approved' | 'rejected') {
		if (!pendingApproval) return;
		acting = true;
		try {
			const res = await fetch(`/api/superadmin/workflows/runs/${runId}/approval`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ step_key: pendingApproval.step_key, decision }),
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error || 'Failed to record decision');
				return;
			}
			toast.success(`Recorded: ${decision}`);
			run = body.run;
			onchanged?.();
		} finally {
			acting = false;
		}
	}

	async function cancelRun() {
		if (!confirm('Cancel this run? Steps already executed are not rolled back.')) return;
		acting = true;
		try {
			const res = await fetch(`/api/superadmin/workflows/runs/${runId}/cancel`, {
				method: 'POST',
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error || 'Failed to cancel run');
				return;
			}
			toast.success('Run cancelled');
			run = body.run;
			onchanged?.();
		} finally {
			acting = false;
		}
	}

	function stepIcon(status) {
		if (status === 'completed') return '✓';
		if (status === 'failed') return '✕';
		if (status === 'running' || status === 'retrying') return '◌';
		if (status === 'waiting') return '⏸';
		if (status === 'skipped') return '⤼';
		return '·';
	}

	function prettyJson(value) {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
</script>

<div
	class="drawer-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose?.();
	}}
>
	<aside class="drawer" aria-label="Run detail">
		<header class="drawer-header">
			<div>
				<h3>Run #{runId}</h3>
				{#if templateName}<span class="muted">{templateName}</span>{/if}
			</div>
			<button class="icon-btn" onclick={() => onclose?.()} title="Close">✕</button>
		</header>

		{#if loading && !run}
			<p class="muted">Loading run…</p>
		{:else if !run}
			<p class="muted">Run not found.</p>
		{:else}
			<div class="run-summary">
				<span class="status-badge {statusBadgeClass(run.status)}">{run.status}</span>
				<span class="muted">
					{run.trigger_source} · v{run.template_version ?? '?'} ·
					{run.started_at || run.created_at}
					{#if run.duration_ms != null}· {formatDuration(run.duration_ms)}{/if}
				</span>
				{#if run.workflow_instance_id}
					<span class="muted">instance: {run.workflow_instance_id}</span>
				{/if}
				{#if run.error_message}
					<p class="run-error">{run.error_message}</p>
				{/if}
			</div>

			{#if pendingApproval}
				<div class="approval-banner">
					<p>
						Waiting for approval on <strong>{pendingApproval.step_key}</strong>
						(times out {pendingApproval.timeout_at}, then {pendingApproval.timeout_route}).
					</p>
					<div class="approval-actions">
						<button
							class="btn btn-primary btn-sm"
							disabled={acting}
							onclick={() => decide('approved')}>Approve</button
						>
						<button
							class="btn btn-danger btn-sm"
							disabled={acting}
							onclick={() => decide('rejected')}>Reject</button
						>
					</div>
				</div>
			{/if}

			<div class="steps">
				{#each run.steps || [] as step (step.step_key)}
					<div class="step-row status-{step.status}">
						<button
							class="step-summary"
							onclick={() =>
								(expandedSteps[step.step_key] = !expandedSteps[step.step_key])}
						>
							<span class="step-icon">{stepIcon(step.status)}</span>
							<span class="step-name">{step.title}</span>
							<span class="step-status">{step.status}</span>
							<span class="step-duration">{formatDuration(step.duration_ms)}</span>
						</button>
						{#if expandedSteps[step.step_key]}
							<div class="step-detail">
								{#if step.error_message}
									<p class="run-error">{step.error_message}</p>
								{/if}
								{#if step.output_json}
									<span class="muted">Output</span>
									<pre>{prettyJson(step.output_json)}</pre>
								{/if}
								{#if step.input_json}
									<span class="muted">Input</span>
									<pre>{prettyJson(step.input_json)}</pre>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if !isTerminalRunStatus(run.status)}
				<button
					class="btn btn-danger btn-sm cancel-btn"
					disabled={acting}
					onclick={cancelRun}>Cancel run</button
				>
			{/if}
		{/if}
	</aside>
</div>

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 60;
		display: flex;
		justify-content: flex-end;
	}
	.drawer {
		width: min(480px, 100vw);
		height: 100%;
		overflow-y: auto;
		background: var(--color-surface);
		border-left: 1px solid var(--color-border);
		padding: 1rem 1.25rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.drawer-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.drawer-header h3 {
		margin: 0;
	}
	.muted {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.icon-btn {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		width: 1.9rem;
		height: 1.9rem;
		cursor: pointer;
		color: inherit;
	}
	.run-summary {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.status-badge {
		align-self: flex-start;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.15rem 0.5rem;
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
	.run-error {
		color: #dc2626;
		font-size: 0.8rem;
		margin: 0;
		word-break: break-word;
	}
	.approval-banner {
		border: 1px solid #d97706;
		border-radius: var(--radius-md);
		padding: 0.75rem;
		font-size: 0.85rem;
	}
	.approval-banner p {
		margin: 0 0 0.5rem;
	}
	.approval-actions {
		display: flex;
		gap: 0.5rem;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.step-row {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.step-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		padding: 0.5rem 0.6rem;
		cursor: pointer;
		text-align: left;
		font-size: 0.85rem;
	}
	.step-icon {
		width: 1.1rem;
		text-align: center;
	}
	.status-completed .step-icon {
		color: #16a34a;
	}
	.status-failed .step-icon {
		color: #dc2626;
	}
	.status-running .step-icon,
	.status-retrying .step-icon {
		color: var(--color-primary);
	}
	.status-waiting .step-icon {
		color: #d97706;
	}
	.step-name {
		flex: 1;
		font-weight: 600;
	}
	.step-status {
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}
	.step-duration {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		min-width: 3.5rem;
		text-align: right;
	}
	.step-detail {
		padding: 0 0.6rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.step-detail pre {
		margin: 0;
		font-size: 0.72rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		overflow-x: auto;
		max-height: 260px;
	}
	.cancel-btn {
		align-self: flex-start;
	}
	.btn {
		cursor: pointer;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		padding: 0.3rem 0.65rem;
		font-size: 0.78rem;
		background: var(--color-surface);
		color: inherit;
	}
	.btn-primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-button-text);
	}
	.btn-danger {
		color: #dc2626;
		border-color: #dc2626;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
