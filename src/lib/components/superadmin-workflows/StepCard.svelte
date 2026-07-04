<script lang="ts">
	import { BRANCH_OPERATORS } from './workflow-ui.js';
	import { routesForType } from '$lib/superadmin-workflow-graph.js';

	let {
		step = $bindable(),
		index,
		total,
		otherSteps = [],
		operationCatalog = [],
		runnerTokens = [],
		runnerTokensLoading = false,
		/** Flat mode shows explicit routing selects on every step (incl. tasks). */
		flatMode = false,
		onmove,
		onremove,
		onneedrunnertokens,
	} = $props();

	let advancedOpen = $state(false);

	const namedRoutes = $derived(routesForType(step.type));
	const showNextRoute = $derived(flatMode && (step.type === 'task' || step.type === 'trigger'));
</script>

<div class="step-card">
	<div class="step-card-header">
		<span class="step-index">{index + 1}</span>
		<span class="type-badge type-{step.type}">{step.type}</span>
		<input class="step-title" type="text" bind:value={step.title} placeholder="Step title" />
		{#if step.type !== 'trigger'}
			<div class="step-controls">
				<button
					class="icon-btn"
					disabled={index === 0}
					onclick={() => onmove?.(step.id, -1)}
					title="Move up">↑</button
				>
				<button
					class="icon-btn"
					disabled={index === total - 1}
					onclick={() => onmove?.(step.id, 1)}
					title="Move down">↓</button
				>
				<button
					class="icon-btn danger"
					onclick={() => onremove?.(step.id)}
					title="Remove step">✕</button
				>
			</div>
		{/if}
	</div>

	{#if step.type === 'task'}
		<label class="field">
			<span>Operation</span>
			<select bind:value={step.data.operation}>
				<option value="">Choose an operation…</option>
				{#each operationCatalog as op (op.key)}
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
						onfocus={() => onneedrunnertokens?.()}
					>
						<option value={0}>Select a runner…</option>
						{#each runnerTokens as token (token.id)}
							<option value={token.id}>
								{token.is_online ? '🟢' : '⚪'}
								{token.name} — {token.owner_display_name || 'unknown owner'}
							</option>
						{/each}
					</select>
					{#if runnerTokensLoading}<span class="field-note">Loading runners…</span>{/if}
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
						onchange={(e) => (step.data.wait_for_result = e.currentTarget.checked)}
					/>
					Wait for result before continuing
				</label>
			</div>
		{/if}

		<button class="btn-link" onclick={() => (advancedOpen = !advancedOpen)}
			>{advancedOpen ? '▾' : '▸'} Advanced</button
		>
		{#if advancedOpen}
			<label class="field">
				<span>Queue key</span>
				<input type="text" bind:value={step.data.queue_key} placeholder="ops.example.key" />
			</label>
		{/if}
	{/if}

	{#if step.type === 'approval'}
		<div class="field-grid">
			<label class="field">
				<span>Decision timeout (hours)</span>
				<input
					type="number"
					min="1"
					max="336"
					bind:value={step.data.timeout_hours}
					placeholder="72"
				/>
			</label>
			<label class="field">
				<span>On timeout</span>
				<select bind:value={step.data.timeout_route}>
					<option value="rejected">Treat as rejected</option>
					<option value="approved">Treat as approved</option>
				</select>
			</label>
		</div>
		<p class="hint">
			Runs pause here until a superadmin approves or rejects from the run detail view.
		</p>
	{/if}

	{#if step.type === 'branch'}
		<div class="field-grid">
			<label class="field">
				<span>Left value</span>
				<input
					type="text"
					bind:value={step.data.left_operand}
					placeholder={'e.g. {variables.count}'}
				/>
			</label>
			<label class="field">
				<span>Operator</span>
				<select bind:value={step.data.operator}>
					{#each BRANCH_OPERATORS as op (op.id)}
						<option value={op.id}>{op.label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Right value</span>
				<input type="text" bind:value={step.data.right_operand} />
			</label>
		</div>
	{/if}

	{#if namedRoutes.length > 0}
		<div class="route-grid">
			{#each namedRoutes as routeName (routeName)}
				<label class="field route-field">
					<span>If <strong>{routeName}</strong>, go to</span>
					<select bind:value={step.routes[routeName]}>
						<option value={null}>End workflow</option>
						{#each otherSteps as target (target.id)}
							<option value={target.id}>{target.title || target.id}</option>
						{/each}
					</select>
				</label>
			{/each}
		</div>
	{/if}

	{#if showNextRoute}
		<div class="route-grid">
			<label class="field route-field">
				<span>Then go to</span>
				<select bind:value={step.routes.next}>
					<option value={null}>End workflow</option>
					{#each otherSteps as target (target.id)}
						<option value={target.id}>{target.title || target.id}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}
</div>

<style>
	.step-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: var(--color-surface);
	}
	.step-card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.step-index {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted);
		min-width: 1.2rem;
		text-align: center;
	}
	.type-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
	}
	.type-badge.type-approval {
		color: #d97706;
	}
	.type-badge.type-branch {
		color: #7c3aed;
	}
	.type-badge.type-trigger {
		color: var(--color-primary);
	}
	.step-title {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: inherit;
		font-weight: 600;
	}
	.step-controls {
		display: flex;
		gap: 0.25rem;
	}
	.icon-btn {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		width: 1.8rem;
		height: 1.8rem;
		cursor: pointer;
		color: inherit;
	}
	.icon-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon-btn.danger {
		color: var(--color-danger, #dc2626);
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
	.field select {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: inherit;
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
	.runner-task-fields {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.6rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
	}
	.toggle-inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		padding: 0;
		font-size: 0.82rem;
		text-align: left;
	}
	.route-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
		padding-top: 0.25rem;
		border-top: 1px dashed var(--color-border);
	}
	.hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
</style>
