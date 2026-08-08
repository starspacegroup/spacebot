<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from '$lib/toast.svelte.js';
	import { getTranslator, getLocale } from '$lib/i18n.js';
	import TrustedHtml from '$lib/components/TrustedHtml.svelte';

	const tr = getTranslator();
	const dateLocale = getLocale() === 'es' ? 'es-ES' : 'en-US';

	const { data } = $props();

	let workflows = $state(untrack(() => data.workflows || []));
	let runnerTokens = $state(untrack(() => data.runnerTokens || []));
	let runnerInstances = $state(untrack(() => data.runnerInstances || []));
	let runnerJobs = $state(untrack(() => data.runnerJobs || []));

	let formName = $state('');
	let formDescription = $state('');
	let formJobType = $state('shell_command');
	let formRunnerStrategy = $state('pinned');
	let formTargetTokenId = $state('');
	let formTargetInstanceId = $state('');
	let formAllowedTokenIds = $state([]);
	let formAllowedInstanceIds = $state([]);
	let formModelMode = $state('first_success');
	let formModelChain = $state('copilot:gpt-4.1\nollama:llama3');
	let formRequireScreenshots = $state(false);
	let formRequireVscode = $state(false);
	let formRequireCopilot = $state(false);
	let creatingWorkflow = $state(false);

	let dispatchWorkflowId = $state('');
	let dispatchCommand = $state('');
	let dispatchLabel = $state('');
	let dispatchPayload = $state('');
	let dispatching = $state(false);

	let queueStatusFilter = $state('all');
	let queueTypeFilter = $state('all');
	let queueSearch = $state('');

	function showToast(message, ok = true) {
		toast[ok ? 'success' : 'error'](message);
	}

	function formatDate(value) {
		if (!value) return '-';
		try {
			return new Date(value).toLocaleString(dateLocale);
		} catch {
			return value;
		}
	}

	function toNumberList(values) {
		if (!Array.isArray(values)) return [];
		return values
			.map((entry) => Number(entry))
			.filter((entry) => Number.isInteger(entry) && entry > 0);
	}

	function parseModelChain(raw) {
		if (!raw || !raw.trim()) return [];

		const lines = raw
			.split(/\n|,/)
			.map((line) => line.trim())
			.filter(Boolean);

		const chain = [];
		for (const line of lines) {
			const [providerRaw, modelRaw, viaRaw] = line
				.split(':')
				.map((part) => String(part || '').trim());
			if (!providerRaw) continue;
			const provider = providerRaw.toLowerCase();
			const entry = {
				provider,
				model: modelRaw || null,
				via: viaRaw || null,
			};
			chain.push(entry);
		}
		return chain;
	}

	function capabilityRequirementsFromForm() {
		const out: Record<string, boolean> = {};
		if (formRequireScreenshots) out.screenshotAvailable = true;
		if (formRequireVscode) out.vscodeControlAvailable = true;
		if (formRequireCopilot) out.copilotMessageAvailable = true;
		return Object.keys(out).length ? out : null;
	}

	function modelPreferencesFromForm() {
		const chain = parseModelChain(formModelChain);
		if (chain.length === 0) return null;
		return {
			mode: formModelMode,
			provider_chain: chain,
		};
	}

	async function refreshAll() {
		const [workflowsRes, runnersRes] = await Promise.all([
			fetch('/api/account/workflows?limit=200'),
			fetch('/api/account/runners?jobsLimit=120&instancesLimit=200'),
		]);

		if (workflowsRes.ok) {
			const workflowsBody = await workflowsRes.json();
			workflows = workflowsBody.workflows || workflows;
		}

		if (runnersRes.ok) {
			const runnersBody = await runnersRes.json();
			runnerTokens = runnersBody.tokens || runnerTokens;
			runnerInstances = runnersBody.instances || runnerInstances;
			runnerJobs = runnersBody.jobs || runnerJobs;
		}
	}

	async function createWorkflow() {
		if (!formName.trim()) return;
		creatingWorkflow = true;
		try {
			const body = {
				name: formName.trim(),
				description: formDescription.trim() || undefined,
				job_type: formJobType,
				runner_strategy: formRunnerStrategy,
				target_runner_token_id: Number(formTargetTokenId) || null,
				target_runner_instance_id: Number(formTargetInstanceId) || null,
				allowed_runner_token_ids_json: toNumberList(formAllowedTokenIds),
				allowed_runner_instance_ids_json: toNumberList(formAllowedInstanceIds),
				model_preferences_json: modelPreferencesFromForm(),
				capability_requirements_json: capabilityRequirementsFromForm(),
			};

			const res = await fetch('/api/account/workflows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const result = await res.json();
			if (!res.ok) {
				showToast(result.error || tr('aiwf.toast.createFailed'), false);
				return;
			}

			formName = '';
			formDescription = '';
			formTargetTokenId = '';
			formTargetInstanceId = '';
			formAllowedTokenIds = [];
			formAllowedInstanceIds = [];
			formRequireScreenshots = false;
			formRequireVscode = false;
			formRequireCopilot = false;

			await refreshAll();
			showToast(tr('aiwf.toast.created'));
		} catch {
			showToast(tr('aiwf.toast.createNetErr'), false);
		} finally {
			creatingWorkflow = false;
		}
	}

	async function toggleWorkflow(workflow, enabled) {
		try {
			const res = await fetch(`/api/account/workflows/${workflow.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled }),
			});
			const result = await res.json();
			if (!res.ok) {
				showToast(result.error || tr('aiwf.toast.updateFailed'), false);
				return;
			}
			workflows = workflows.map((item) => (item.id === workflow.id ? result.workflow : item));
		} catch {
			showToast(tr('aiwf.toast.updateNetErr'), false);
		}
	}

	async function deleteWorkflow(id) {
		if (!confirm(tr('aiwf.confirmDelete'))) return;
		try {
			const res = await fetch(`/api/account/workflows/${id}`, { method: 'DELETE' });
			const result = await res.json();
			if (!res.ok) {
				showToast(result.error || tr('aiwf.toast.deleteFailed'), false);
				return;
			}
			workflows = workflows.filter((item) => item.id !== id);
			showToast(tr('aiwf.toast.deleted'));
		} catch {
			showToast(tr('aiwf.toast.deleteNetErr'), false);
		}
	}

	async function dispatchWorkflow() {
		if (!dispatchWorkflowId) return;
		dispatching = true;
		try {
			let payloadJson = undefined;
			if (dispatchPayload.trim()) {
				try {
					payloadJson = JSON.parse(dispatchPayload);
				} catch {
					showToast(tr('aiwf.toast.payloadInvalid'), false);
					return;
				}
			}

			const res = await fetch(`/api/account/workflows/${dispatchWorkflowId}/dispatch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					command: dispatchCommand.trim() || undefined,
					label: dispatchLabel.trim() || undefined,
					payload_json: payloadJson,
				}),
			});
			const result = await res.json();
			if (!res.ok) {
				showToast(result.error || tr('aiwf.toast.dispatchFailed'), false);
				return;
			}

			const jobCount = Array.isArray(result.jobIds) ? result.jobIds.length : 1;
			showToast(tr('aiwf.toast.dispatched', { count: jobCount }));
			dispatchCommand = '';
			dispatchLabel = '';
			dispatchPayload = '';
			await refreshAll();
		} catch {
			showToast(tr('aiwf.toast.dispatchNetErr'), false);
		} finally {
			dispatching = false;
		}
	}

	async function updateJob(jobId, action) {
		const msgs =
			action === 'cancel'
				? {
						failed: tr('aiwf.toast.cancelFailed'),
						done: tr('aiwf.toast.cancelDone'),
						net: tr('aiwf.toast.cancelNetErr'),
					}
				: {
						failed: tr('aiwf.toast.retryFailed'),
						done: tr('aiwf.toast.retryDone'),
						net: tr('aiwf.toast.retryNetErr'),
					};
		try {
			const res = await fetch(`/api/account/runners/jobs/${jobId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			});
			const result = await res.json();
			if (!res.ok) {
				showToast(result.error || msgs.failed, false);
				return;
			}
			await refreshAll();
			showToast(msgs.done);
		} catch {
			showToast(msgs.net, false);
		}
	}

	function onlineInstances() {
		return runnerInstances.filter((instance) => instance.is_online);
	}

	function statusClass(status) {
		if (status === 'completed') return 'ok';
		if (status === 'running') return 'warn';
		if (status === 'failed') return 'err';
		if (status === 'canceled') return 'mute';
		return 'info';
	}

	const queueJobTypes = $derived.by(() => {
		const types = new Set();
		for (const job of runnerJobs || []) {
			if (job?.job_type) {
				types.add(job.job_type);
			}
		}
		return [...types].sort();
	});

	const filteredRunnerJobs = $derived.by(() => {
		const search = queueSearch.trim().toLowerCase();
		return (runnerJobs || []).filter((job) => {
			if (queueStatusFilter !== 'all' && job.status !== queueStatusFilter) {
				return false;
			}
			if (queueTypeFilter !== 'all' && job.job_type !== queueTypeFilter) {
				return false;
			}
			if (!search) {
				return true;
			}

			const haystack = [
				String(job.id || ''),
				String(job.job_type || ''),
				String(job.status || ''),
				String(job.label || ''),
				String(job.command || ''),
				String(job.runner_name || ''),
				String(job.target_instance_name || ''),
				String(job.claimed_by_instance_name || ''),
			]
				.join(' ')
				.toLowerCase();

			return haystack.includes(search);
		});
	});
</script>

<svelte:head>
	<title>{tr('aiwf.metaTitle')}</title>
</svelte:head>

<div class="ops-page">
	<header class="ops-header">
		<div>
			<h1>{tr('aiwf.title')}</h1>
			<p>{tr('aiwf.subtitle')}</p>
		</div>
		<div class="ops-header-links">
			<a href="/account">{tr('aiwf.account')}</a>
			<a href="#jobs">{tr('aiwf.queue')}</a>
		</div>
	</header>

	<section class="panel quickstart-panel">
		<h2>{tr('aiwf.startHere')}</h2>
		<p class="muted">{tr('aiwf.startDesc')}</p>
		<div class="quickstart-grid">
			<a class="quickstart-card" href="#workflow-builder">
				<strong>{tr('aiwf.qs1.title')}</strong>
				<span>{tr('aiwf.qs1.desc')}</span>
			</a>
			<a class="quickstart-card" href="#dispatch">
				<strong>{tr('aiwf.qs2.title')}</strong>
				<span>{tr('aiwf.qs2.desc')}</span>
			</a>
			<a class="quickstart-card" href="#jobs">
				<strong>{tr('aiwf.qs3.title')}</strong>
				<span>{tr('aiwf.qs3.desc')}</span>
			</a>
		</div>
	</section>

	<section class="ops-grid stats-grid">
		<article>
			<h3>{tr('aiwf.workflows')}</h3>
			<strong>{workflows.length}</strong>
			<span
				>{tr('aiwf.enabledCount', {
					count: workflows.filter((workflow) => workflow.enabled).length,
				})}</span
			>
		</article>
		<article>
			<h3>{tr('aiwf.runners')}</h3>
			<strong>{runnerTokens.filter((token) => !token.revoked).length}</strong>
			<span>{tr('aiwf.onlineInstances', { count: onlineInstances().length })}</span>
		</article>
		<article>
			<h3>{tr('aiwf.queue')}</h3>
			<strong>{runnerJobs.length}</strong>
			<span
				>{tr('aiwf.activeCount', {
					count: runnerJobs.filter(
						(job) => job.status === 'pending' || job.status === 'running'
					).length,
				})}</span
			>
		</article>
	</section>

	<section id="workflow-builder" class="panel">
		<h2>{tr('aiwf.createWorkflow')}</h2>
		<p class="muted">{tr('aiwf.createDesc')}</p>

		<div class="form-grid">
			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.name')}
				bind:value={formName}
			/>
			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.description')}
				bind:value={formDescription}
			/>

			<select class="input" bind:value={formJobType}>
				<option value="shell_command">shell_command</option>
				<option value="dm">dm</option>
				<option value="screenshot_capture">screenshot_capture</option>
				<option value="system_profile">system_profile</option>
				<option value="vscode_discover_instances">vscode_discover_instances</option>
				<option value="vscode_send_copilot_message">vscode_send_copilot_message</option>
			</select>

			<select class="input" bind:value={formRunnerStrategy}>
				<option value="pinned">{tr('aiwf.strategy.pinned')}</option>
				<option value="any_online">{tr('aiwf.strategy.anyOnline')}</option>
				<option value="all_online">{tr('aiwf.strategy.allOnline')}</option>
			</select>

			<select class="input" bind:value={formTargetTokenId}>
				<option value="">{tr('aiwf.targetToken')}</option>
				{#each runnerTokens.filter((token) => !token.revoked) as token (token.id)}
					<option value={token.id}>{token.name} ({token.token_prefix}...)</option>
				{/each}
			</select>

			<select class="input" bind:value={formTargetInstanceId}>
				<option value="">{tr('aiwf.targetInstance')}</option>
				{#each runnerInstances as instance (instance.id)}
					<option value={instance.id}
						>{instance.display_name}
						{instance.is_online ? tr('aiwf.online') : tr('aiwf.offline')}</option
					>
				{/each}
			</select>

			<select class="input" bind:value={formModelMode}>
				<option value="first_success">{tr('aiwf.mode.firstSuccess')}</option>
				<option value="fanout_all">{tr('aiwf.mode.fanoutAll')}</option>
			</select>

			<textarea
				class="input"
				rows="3"
				bind:value={formModelChain}
				placeholder={tr('aiwf.ph.modelChain')}></textarea>

			<select class="input" multiple bind:value={formAllowedTokenIds}>
				{#each runnerTokens.filter((token) => !token.revoked) as token (token.id)}
					<option value={String(token.id)}
						>{tr('aiwf.allowToken', { name: token.name })}</option
					>
				{/each}
			</select>

			<select class="input" multiple bind:value={formAllowedInstanceIds}>
				{#each runnerInstances as instance (instance.id)}
					<option value={String(instance.id)}
						>{tr('aiwf.allowInstance', { name: instance.display_name })}</option
					>
				{/each}
			</select>
		</div>

		<p class="muted form-hint"><TrustedHtml html={tr('aiwf.modelChainHint')} /></p>

		<div class="capability-row">
			<label
				><input type="checkbox" bind:checked={formRequireScreenshots} />
				{tr('aiwf.requireScreenshots')}</label
			>
			<label
				><input type="checkbox" bind:checked={formRequireVscode} />
				{tr('aiwf.requireVscode')}</label
			>
			<label
				><input type="checkbox" bind:checked={formRequireCopilot} />
				{tr('aiwf.requireCopilot')}</label
			>
		</div>

		<button
			class="btn"
			onclick={createWorkflow}
			disabled={creatingWorkflow || !formName.trim()}
		>
			{creatingWorkflow ? tr('aiwf.creating') : tr('aiwf.createWorkflow')}
		</button>
	</section>

	<section id="workflow-inventory" class="panel">
		<h2>{tr('aiwf.inventory')}</h2>
		<div class="workflow-list">
			{#if workflows.length === 0}
				<p class="muted">{tr('aiwf.noWorkflows')}</p>
			{:else}
				{#each workflows as workflow (workflow.id)}
					<article class="workflow-card">
						<div>
							<strong>{workflow.name}</strong>
							<p class="muted">{workflow.description || tr('aiwf.noDescription')}</p>
							<p class="meta">
								{workflow.job_type} • {workflow.runner_strategy || 'pinned'} • {workflow
									.model_preferences_json?.mode || 'first_success'}
							</p>
						</div>
						<div class="workflow-actions">
							<label>
								<input
									type="checkbox"
									checked={Boolean(workflow.enabled)}
									onchange={(event) =>
										toggleWorkflow(workflow, event.currentTarget.checked)}
								/>
								{workflow.enabled
									? tr('aiwf.enabledLabel')
									: tr('aiwf.disabledLabel')}
							</label>
							<button
								class="btn btn-danger"
								onclick={() => deleteWorkflow(workflow.id)}
								>{tr('aiwf.delete')}</button
							>
						</div>
					</article>
				{/each}
			{/if}
		</div>
	</section>

	<section id="dispatch" class="panel">
		<h2>{tr('aiwf.dispatchWorkflow')}</h2>
		<div class="dispatch-grid">
			<select class="input" bind:value={dispatchWorkflowId}>
				<option value="">{tr('aiwf.chooseWorkflow')}</option>
				{#each workflows.filter((workflow) => workflow.enabled) as workflow (workflow.id)}
					<option value={String(workflow.id)}>{workflow.name}</option>
				{/each}
			</select>
			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.commandOverride')}
				bind:value={dispatchCommand}
			/>
			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.labelOverride')}
				bind:value={dispatchLabel}
			/>
			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.payloadJson')}
				bind:value={dispatchPayload}
			/>
			<button
				class="btn"
				onclick={dispatchWorkflow}
				disabled={dispatching || !dispatchWorkflowId}
			>
				{dispatching ? tr('aiwf.dispatching') : tr('aiwf.dispatchBtn')}
			</button>
		</div>
	</section>

	<section id="jobs" class="panel">
		<h2>{tr('aiwf.queueControl')}</h2>
		<p class="muted">{tr('aiwf.queueDesc')}</p>

		<div class="queue-toolbar">
			<select class="input" bind:value={queueStatusFilter}>
				<option value="all">{tr('aiwf.allStatuses')}</option>
				<option value="pending">{tr('aiwf.status.pending')}</option>
				<option value="running">{tr('aiwf.status.running')}</option>
				<option value="completed">{tr('aiwf.status.completed')}</option>
				<option value="failed">{tr('aiwf.status.failed')}</option>
				<option value="canceled">{tr('aiwf.status.canceled')}</option>
			</select>

			<select class="input" bind:value={queueTypeFilter}>
				<option value="all">{tr('aiwf.allJobTypes')}</option>
				{#each queueJobTypes as type (type)}
					<option value={type}>{type}</option>
				{/each}
			</select>

			<input
				class="input"
				type="text"
				placeholder={tr('aiwf.ph.searchQueue')}
				bind:value={queueSearch}
			/>
		</div>

		<p class="meta">
			{tr('aiwf.showingJobs', {
				shown: Math.min(filteredRunnerJobs.length, 80),
				total: filteredRunnerJobs.length,
			})}
		</p>

		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>{tr('aiwf.col.id')}</th>
						<th>{tr('aiwf.col.type')}</th>
						<th>{tr('aiwf.col.status')}</th>
						<th>{tr('aiwf.col.runner')}</th>
						<th>{tr('aiwf.col.attempts')}</th>
						<th>{tr('aiwf.col.updated')}</th>
						<th>{tr('aiwf.col.actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#if filteredRunnerJobs.length === 0}
						<tr>
							<td colspan="7" class="muted">{tr('aiwf.noJobsMatch')}</td>
						</tr>
					{:else}
						{#each filteredRunnerJobs.slice(0, 80) as job (job.id)}
							<tr>
								<td>#{job.id}</td>
								<td>{job.job_type}</td>
								<td
									><span class={`status ${statusClass(job.status)}`}
										>{job.status}</span
									></td
								>
								<td
									>{job.claimed_by_instance_name ||
										job.target_instance_name ||
										job.runner_name ||
										'-'}</td
								>
								<td>{job.attempt_count}/{job.max_attempts}</td>
								<td>{formatDate(job.updated_at || job.created_at)}</td>
								<td>
									{#if job.status === 'pending' || job.status === 'running'}
										<button
											class="btn btn-danger"
											onclick={() => updateJob(job.id, 'cancel')}
											>{tr('aiwf.cancel')}</button
										>
									{:else if job.status === 'failed' || job.status === 'canceled'}
										<button
											class="btn"
											onclick={() => updateJob(job.id, 'retry')}
											>{tr('aiwf.retry')}</button
										>
									{:else}
										<span class="muted">-</span>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</section>
</div>

<style>
	.ops-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.25rem;
		display: grid;
		gap: 1rem;
	}

	.ops-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.ops-header h1 {
		margin: 0;
		font-size: 1.6rem;
	}

	.ops-header p {
		margin: 0.35rem 0 0;
		color: var(--color-text-muted);
	}

	.ops-header-links {
		display: flex;
		gap: 0.5rem;
	}

	.ops-header-links a {
		text-decoration: none;
		color: var(--color-primary, #0d6efd);
		font-size: 0.85rem;
	}

	.ops-grid {
		display: grid;
		gap: 0.75rem;
	}

	.stats-grid {
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	}

	.stats-grid article {
		border: 1px solid var(--color-border, #333);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}

	.stats-grid h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.stats-grid strong {
		display: block;
		margin-top: 0.35rem;
		font-size: 1.45rem;
	}

	.stats-grid span {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.panel {
		border: 1px solid var(--color-border, #333);
		border-radius: 0.55rem;
		padding: 0.9rem;
		background: color-mix(in oklab, var(--card-bg, #121019) 90%, #1e293b 10%);
	}

	.panel h2 {
		margin: 0;
		font-size: 1rem;
	}

	.quickstart-panel {
		padding-top: 0.75rem;
	}

	.quickstart-grid {
		margin-top: 0.65rem;
		display: grid;
		gap: 0.55rem;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}

	.quickstart-card {
		border: 1px solid var(--color-border, #333);
		border-radius: 0.45rem;
		padding: 0.65rem;
		text-decoration: none;
		color: inherit;
		display: grid;
		gap: 0.25rem;
		background: color-mix(in oklab, var(--color-surface, #0f0f12) 85%, #1e293b 15%);
	}

	.quickstart-card span {
		color: var(--color-text-muted);
		font-size: 0.78rem;
	}

	.muted {
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}

	.meta {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.form-grid,
	.dispatch-grid {
		margin-top: 0.7rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 0.5rem;
	}

	.capability-row {
		margin-top: 0.6rem;
		display: flex;
		gap: 0.8rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
	}

	.form-hint {
		margin-top: 0.45rem;
	}

	.queue-toolbar {
		margin-top: 0.65rem;
		display: grid;
		grid-template-columns: 180px 220px minmax(240px, 1fr);
		gap: 0.5rem;
	}

	.input {
		width: 100%;
		box-sizing: border-box;
		min-height: 2rem;
		padding: 0.45rem 0.55rem;
		background: var(--color-surface, #0f0f12);
		border: 1px solid var(--color-border, #333);
		border-radius: 0.4rem;
		color: var(--color-text, #f4f4f5);
		font-size: 0.85rem;
	}

	.btn {
		min-height: 2rem;
		border: 1px solid var(--color-primary, #0d6efd);
		color: var(--color-primary, #0d6efd);
		border-radius: 0.4rem;
		background: transparent;
		cursor: pointer;
		padding: 0.4rem 0.6rem;
		font-size: 0.82rem;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-danger {
		border-color: #ef4444;
		color: #ef4444;
	}

	.workflow-list {
		margin-top: 0.7rem;
		display: grid;
		gap: 0.5rem;
	}

	.workflow-card {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.8rem;
		border: 1px solid var(--color-border, #333);
		border-radius: 0.45rem;
		padding: 0.65rem;
	}

	.workflow-card strong {
		font-size: 0.92rem;
	}

	.workflow-card p {
		margin: 0.25rem 0 0;
	}

	.workflow-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
	}

	.table-wrap {
		margin-top: 0.6rem;
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		text-align: left;
		padding: 0.52rem;
		border-bottom: 1px solid var(--color-border, #333);
		vertical-align: top;
		font-size: 0.84rem;
	}

	.status {
		display: inline-block;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 0.13rem 0.45rem;
		font-size: 0.74rem;
	}

	.status.ok {
		background: color-mix(in oklab, #10b981 22%, transparent);
		border-color: color-mix(in oklab, #10b981 42%, transparent);
	}

	.status.warn {
		background: color-mix(in oklab, #f59e0b 20%, transparent);
		border-color: color-mix(in oklab, #f59e0b 40%, transparent);
	}

	.status.err {
		background: color-mix(in oklab, #ef4444 20%, transparent);
		border-color: color-mix(in oklab, #ef4444 40%, transparent);
	}

	.status.info,
	.status.mute {
		background: color-mix(in oklab, #64748b 20%, transparent);
		border-color: color-mix(in oklab, #64748b 40%, transparent);
	}

	@media (max-width: 760px) {
		.ops-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.workflow-card {
			flex-direction: column;
		}

		.queue-toolbar {
			grid-template-columns: 1fr;
		}
	}
</style>
