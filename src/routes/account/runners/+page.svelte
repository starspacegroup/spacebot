<script>
	import Toast from '$lib/components/Toast.svelte';
	import { onMount } from 'svelte';
	import { untrack } from 'svelte';

	const RUNNER_UI_PREFS_STORAGE_KEY = 'spacebot.account.runnerUi.showRevoked';
	const RUNNER_DEFAULT_MAX_ATTEMPTS = 5;
	const RUNNER_MIN_MAX_ATTEMPTS = 1;
	const RUNNER_MAX_MAX_ATTEMPTS = 20;

	let { data } = $props();

	let toastMessage = $state(null);
	let toastSuccess = $state(true);
	let showToast = $state(false);

	function normalizeRunnerMaxAttempts(value) {
		const raw = Number(value);
		if (!Number.isFinite(raw)) return RUNNER_DEFAULT_MAX_ATTEMPTS;
		return Math.max(RUNNER_MIN_MAX_ATTEMPTS, Math.min(RUNNER_MAX_MAX_ATTEMPTS, Math.round(raw)));
	}

	let runnerTokens = $state(untrack(() => data.runnerTokens ?? []));
	let runnerInstances = $state(untrack(() => data.runnerInstances ?? []));
	const RUNNER_REFRESH_INTERVAL_MS = 15_000;

	let newRunnerName = $state('');
	let creatingRunner = $state(false);
	let newRawToken = $state(null);
	let newRawTokenCopied = $state(false);
	let showRevokedRunners = $state(untrack(() => Boolean(data?.runnerUiPrefs?.showRevoked)));
	let preferLocalRunnerForDM = $state(untrack(() => Boolean(data?.runnerUiPrefs?.preferLocalRunnerForDM)));
	let defaultMaxAttempts = $state(untrack(() => normalizeRunnerMaxAttempts(data?.runnerUiPrefs?.defaultMaxAttempts)));
	let runnerPrefsInitialized = $state(false);
	let runnerPrefsSaveInFlight = false;
	let lastSavedRunnerPrefs = null;
	let runnerPrefsPendingValue = null;
	let runnerPrefsSaveStatus = $state('idle');
	let runnerPrefsSavedTimer = null;

	let dispatchTokenId = $state(null);
	let dispatchCommand = $state('');
	let dispatchWorkDir = $state('');
	let dispatchLabel = $state('');
	let dispatching = $state(false);
	let copilotPrompt = $state('');

	let workflows = $state(untrack(() => data.workflows ?? []));
	let newWorkflowName = $state('');
	let newWorkflowDescription = $state('');
	let newWorkflowJobType = $state('shell_command');
	let newWorkflowTargetTokenId = $state('');
	let creatingWorkflow = $state(false);
	let workflowDispatchId = $state('');
	let workflowDispatchCommand = $state('');
	let workflowDispatchLabel = $state('');
	let workflowDispatchPayload = $state('');
	let dispatchingWorkflow = $state(false);

	function isRunnerOnline(token) {
		if (token.revoked) return false;
		return instancesForToken(token.id).some((instance) => instance.is_online);
	}

	async function refreshRunnerData() {
		const listRes = await fetch('/api/account/runners');
		if (!listRes.ok) return;
		const listBody = await listRes.json();
		runnerTokens = listBody.tokens || runnerTokens;
		runnerInstances = listBody.instances || runnerInstances;
	}

	async function refreshWorkflows() {
		const res = await fetch('/api/account/workflows');
		if (!res.ok) return;
		const body = await res.json();
		workflows = body.workflows || workflows;
	}

	onMount(() => {
		try {
			const raw = localStorage.getItem(RUNNER_UI_PREFS_STORAGE_KEY);
			if (data?.runnerUiPrefs?.showRevoked === undefined && raw !== null) {
				showRevokedRunners = raw === '1';
			}
		} catch {}

		lastSavedRunnerPrefs = {
			showRevoked: showRevokedRunners,
			preferLocalRunnerForDM,
			defaultMaxAttempts: Number(defaultMaxAttempts),
		};

		runnerPrefsInitialized = true;

		const refreshTimer = setInterval(() => {
			refreshRunnerData().catch(() => {});
			refreshWorkflows().catch(() => {});
		}, RUNNER_REFRESH_INTERVAL_MS);
		return () => clearInterval(refreshTimer);
	});

	async function createWorkflow() {
		if (!newWorkflowName.trim()) return;
		creatingWorkflow = true;
		try {
			const res = await fetch('/api/account/workflows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newWorkflowName.trim(),
					description: newWorkflowDescription.trim() || undefined,
					job_type: newWorkflowJobType,
					target_runner_token_id: Number(newWorkflowTargetTokenId) || undefined,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to create workflow';
				toastSuccess = false;
				showToast = true;
				return;
			}
			workflows = [body.workflow, ...workflows];
			newWorkflowName = '';
			newWorkflowDescription = '';
			newWorkflowJobType = 'shell_command';
			newWorkflowTargetTokenId = '';
			toastMessage = 'Workflow created.';
			toastSuccess = true;
			showToast = true;
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			creatingWorkflow = false;
		}
	}

	async function setWorkflowEnabled(workflow, enabled) {
		try {
			const res = await fetch(`/api/account/workflows/${workflow.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled }),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to update workflow';
				toastSuccess = false;
				showToast = true;
				return;
			}
			workflows = workflows.map((item) => item.id === workflow.id ? body.workflow : item);
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		}
	}

	async function deleteWorkflow(id) {
		if (!confirm('Delete this workflow? This cannot be undone.')) return;
		try {
			const res = await fetch(`/api/account/workflows/${id}`, { method: 'DELETE' });
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to delete workflow';
				toastSuccess = false;
				showToast = true;
				return;
			}
			workflows = workflows.filter((item) => item.id !== id);
			if (String(workflowDispatchId) === String(id)) workflowDispatchId = '';
			toastMessage = 'Workflow deleted.';
			toastSuccess = true;
			showToast = true;
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		}
	}

	async function dispatchWorkflowNow() {
		if (!workflowDispatchId) return;
		dispatchingWorkflow = true;
		try {
			let payloadJson = undefined;
			if (workflowDispatchPayload.trim()) {
				try {
					payloadJson = JSON.parse(workflowDispatchPayload);
				} catch {
					toastMessage = 'Payload JSON is invalid';
					toastSuccess = false;
					showToast = true;
					return;
				}
			}

			const res = await fetch(`/api/account/workflows/${workflowDispatchId}/dispatch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					command: workflowDispatchCommand.trim() || undefined,
					label: workflowDispatchLabel.trim() || undefined,
					payload_json: payloadJson,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to dispatch workflow';
				toastSuccess = false;
				showToast = true;
				return;
			}
			toastMessage = `Workflow queued job #${body.jobId}.`;
			toastSuccess = true;
			showToast = true;
			workflowDispatchCommand = '';
			workflowDispatchLabel = '';
			workflowDispatchPayload = '';
			await refreshRunnerData();
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			dispatchingWorkflow = false;
		}
	}

	function persistRunnerUiPreference(nextPrefs) {
		if (runnerPrefsSaveInFlight) {
			runnerPrefsPendingValue = nextPrefs;
			return;
		}

		runnerPrefsSaveInFlight = true;
		lastSavedRunnerPrefs = { ...nextPrefs };
		runnerPrefsSaveStatus = 'saving';
		const normalizedMaxAttempts = normalizeRunnerMaxAttempts(nextPrefs?.defaultMaxAttempts);

		fetch('/api/account/preferences', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				runnerUi: {
					showRevoked: Boolean(nextPrefs?.showRevoked),
					preferLocalRunnerForDM: Boolean(nextPrefs?.preferLocalRunnerForDM),
					defaultMaxAttempts: normalizedMaxAttempts,
				},
			}),
		})
			.then((res) => {
				if (!res.ok) throw new Error('Failed to save');
				runnerPrefsSaveStatus = 'saved';
				if (runnerPrefsSavedTimer) clearTimeout(runnerPrefsSavedTimer);
				runnerPrefsSavedTimer = setTimeout(() => {
					runnerPrefsSaveStatus = 'idle';
				}, 1800);
			})
			.catch(() => {
				lastSavedRunnerPrefs = null;
				runnerPrefsSaveStatus = 'error';
			})
			.finally(() => {
				runnerPrefsSaveInFlight = false;
				const pendingChanged = runnerPrefsPendingValue !== null
					&& (
						runnerPrefsPendingValue.showRevoked !== lastSavedRunnerPrefs?.showRevoked
						|| runnerPrefsPendingValue.preferLocalRunnerForDM !== lastSavedRunnerPrefs?.preferLocalRunnerForDM
						|| runnerPrefsPendingValue.defaultMaxAttempts !== lastSavedRunnerPrefs?.defaultMaxAttempts
					);
				if (pendingChanged) {
					const pending = runnerPrefsPendingValue;
					runnerPrefsPendingValue = null;
					persistRunnerUiPreference(pending);
				} else {
					runnerPrefsPendingValue = null;
				}
			});
	}

	$effect(() => {
		if (!runnerPrefsInitialized) return;

		const nextPrefs = {
			showRevoked: showRevokedRunners,
			preferLocalRunnerForDM,
			defaultMaxAttempts: normalizeRunnerMaxAttempts(defaultMaxAttempts),
		};

		if (
			lastSavedRunnerPrefs
			&& lastSavedRunnerPrefs.showRevoked === nextPrefs.showRevoked
			&& lastSavedRunnerPrefs.preferLocalRunnerForDM === nextPrefs.preferLocalRunnerForDM
			&& lastSavedRunnerPrefs.defaultMaxAttempts === nextPrefs.defaultMaxAttempts
		) return;

		try {
			localStorage.setItem(RUNNER_UI_PREFS_STORAGE_KEY, showRevokedRunners ? '1' : '0');
		} catch {}

		persistRunnerUiPreference(nextPrefs);
	});

	async function createRunner() {
		if (!newRunnerName.trim()) return;
		creatingRunner = true;
		try {
			const res = await fetch('/api/account/runners', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newRunnerName.trim() }),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to create runner';
				toastSuccess = false;
				showToast = true;
				return;
			}
			runnerTokens = [body.token, ...runnerTokens];
			newRawToken = body.rawToken;
			newRawTokenCopied = false;
			newRunnerName = '';
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			creatingRunner = false;
		}
	}

	async function revokeRunner(id) {
		if (!confirm('Revoke this runner token? The runner will stop working immediately.')) return;
		try {
			const res = await fetch(`/api/account/runners/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json();
				toastMessage = body.error || 'Failed to revoke runner';
				toastSuccess = false;
				showToast = true;
				return;
			}
			runnerTokens = runnerTokens.map(t => t.id === id ? { ...t, revoked: true } : t);
			toastMessage = 'Runner revoked.';
			toastSuccess = true;
			showToast = true;
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		}
	}

	async function deleteRunner(id) {
		if (!confirm('Permanently delete this revoked runner and all its history? This cannot be undone.')) return;
		try {
			const res = await fetch(`/api/account/runners/${id}?permanent=1`, { method: 'DELETE' });
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to delete runner';
				toastSuccess = false;
				showToast = true;
				return;
			}
			runnerTokens = runnerTokens.filter((t) => t.id !== id);
			runnerInstances = runnerInstances.filter((i) => i.runner_token_id !== id);
			if (dispatchTokenId === id) dispatchTokenId = null;
			toastMessage = 'Runner deleted.';
			toastSuccess = true;
			showToast = true;
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		}
	}

	async function dispatchJob() {
		if (!dispatchCommand.trim() || !dispatchTokenId) return;
		dispatching = true;
		try {
			const maxAttempts = normalizeRunnerMaxAttempts(defaultMaxAttempts);
			const res = await fetch(`/api/account/runners/${dispatchTokenId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					command: dispatchCommand.trim(),
					working_dir: dispatchWorkDir.trim() || undefined,
					label: dispatchLabel.trim() || undefined,
					max_attempts: maxAttempts,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || 'Failed to queue job';
				toastSuccess = false;
				showToast = true;
				return;
			}
			toastMessage = `Job #${body.jobId} queued — runner will pick it up shortly.`;
			toastSuccess = true;
			showToast = true;
			dispatchCommand = '';
			dispatchWorkDir = '';
			dispatchLabel = '';
			dispatchTokenId = null;
			await refreshRunnerData();
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			dispatching = false;
		}
	}

	async function queueTypedJob(tokenId, jobType, payload = {}, label = null, targetInstanceId = undefined) {
		dispatching = true;
		try {
			const oneShotJobTypes = new Set(['screenshot_capture', 'dm']);
			const maxAttempts = oneShotJobTypes.has(jobType)
				? 1
				: normalizeRunnerMaxAttempts(defaultMaxAttempts);
			const res = await fetch(`/api/account/runners/${tokenId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					job_type: jobType,
					payload_json: payload,
					label,
					target_instance_id: targetInstanceId,
					max_attempts: maxAttempts,
				}),
			});
			const body = await res.json();
			if (!res.ok) {
				toastMessage = body.error || `Failed to queue ${jobType}`;
				toastSuccess = false;
				showToast = true;
				return;
			}
			toastMessage = `Job #${body.jobId} queued (${jobType}).`;
			toastSuccess = true;
			showToast = true;
			await refreshRunnerData();
		} catch {
			toastMessage = 'Network error. Please try again.';
			toastSuccess = false;
			showToast = true;
		} finally {
			dispatching = false;
		}
	}

	function instancesForToken(tokenId) {
		return runnerInstances.filter((i) => i.runner_token_id === tokenId);
	}

	function visibleRunnerTokens() {
		if (showRevokedRunners) return runnerTokens;
		return runnerTokens.filter((token) => !token.revoked);
	}

	function formatBytes(bytes) {
		if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex += 1;
		}
		const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
		return `${value.toFixed(precision)} ${units[unitIndex]}`;
	}

	function summarizePaths(paths) {
		if (!Array.isArray(paths) || paths.length === 0) return 'none';
		const preview = paths.slice(0, 2).join(', ');
		return paths.length > 2 ? `${preview}, +${paths.length - 2} more` : preview;
	}

	function getRunnerSystemProfile(instance) {
		return instance?.metadata?.systemProfile || null;
	}

	function getRunnerSystemSummary(instance) {
		const profile = getRunnerSystemProfile(instance);
		const machine = profile?.machine || {};
		const os = profile?.os || {};
		const hardware = profile?.hardware || {};
		const displays = profile?.displays || {};
		const platformLabel = os.platform || instance?.platform || 'unknown';
		const osFamilyLabel = machine.osFamily || 'unknown';
		const machineClassLabel = machine.class || 'unknown';
		const archLabel = os.arch || instance?.arch || 'unknown';
		const cpuCount = Number.isFinite(hardware.cpuCount) ? hardware.cpuCount : null;
		const memoryLabel = formatBytes(hardware.totalMemoryBytes);
		const displayCount = Number.isFinite(displays.count) ? displays.count : 0;
		const arrangementLabel = displays.arrangementKnown ? 'arrangement known' : 'arrangement unknown';
		return `${machineClassLabel} · ${osFamilyLabel} (${platformLabel}/${archLabel})${cpuCount ? ` · ${cpuCount} cores` : ''} · ${memoryLabel} RAM · ${displayCount} display${displayCount === 1 ? '' : 's'} · ${arrangementLabel}`;
	}

	function getRunnerPermissionsSummary(instance) {
		const allowedPaths = instance?.metadata?.allowedPaths;
		return summarizePaths(allowedPaths);
	}

	function getRunnerCapabilityState(instance, key) {
		const caps = instance?.metadata?.capabilities || {};
		if (!(key in caps)) return 'unknown';
		return caps[key] ? 'ready' : 'unavailable';
	}

	function getCopilotAvailability(instance) {
		const caps = instance?.metadata?.capabilities || {};
		const llm = instance?.metadata?.llm || {};
		if (caps.copilotMessageAvailable) return 'ready';
		if (llm.copilot?.configured) return 'configured, bridge unavailable';
		return 'not configured';
	}

	function getCopilotConfigSummary(instance) {
		const llm = instance?.metadata?.llm || {};
		if (!llm.copilot?.configured) return 'missing';
		const via = llm.copilot.via ? `via ${llm.copilot.via}` : 'configured';
		return llm.copilot.model ? `${via} · ${llm.copilot.model}` : via;
	}

	function providerLabel(instance) {
		const llm = instance?.metadata?.llm;
		if (!llm) return 'unknown';
		if (llm.preferredProvider) return llm.preferredProvider;
		if (Array.isArray(llm.chain) && llm.chain.length > 0) {
			return llm.chain.map((entry) => entry.provider).join(' -> ');
		}
		return 'unconfigured';
	}

	function modelLabel(instance) {
		const llm = instance?.metadata?.llm;
		if (!llm) return 'unknown';
		const chain = Array.isArray(llm.chain) ? llm.chain : [];
		const models = chain
			.map((entry) => entry?.model)
			.filter((model) => typeof model === 'string' && model.trim().length > 0);
		if (models.length > 0) return models.join(' -> ');
		if (llm.copilot?.model) return llm.copilot.model;
		if (llm.ollama?.model) return llm.ollama.model;
		return 'unconfigured';
	}

	function copyRawToken() {
		if (!newRawToken) return;
		navigator.clipboard.writeText(newRawToken).then(() => {
			newRawTokenCopied = true;
		});
	}

</script>

<svelte:head>
	<title>Local Runner | SpaceBot</title>
</svelte:head>

<div class="runners-page">
	{#if showToast && toastMessage}
		<Toast message={toastMessage} success={toastSuccess} onDismiss={() => showToast = false} />
	{/if}

	<header class="page-header">
		<a href="/account" class="back-link">&#8592; Back to Account</a>
		<div class="header-content">
			<h1>
				<span class="header-icon">🖥️</span>
				Local Runner
			</h1>
			<p class="header-desc">
				Manage runners, workflows, and job dispatch. Runners authenticate with a secret token and execute jobs from the queue.
			</p>
		</div>
	</header>

	<!-- Runner Behavior Settings -->
	<section class="content-section">
		<h2><span class="section-icon">⚙️</span> Runner Settings</h2>
		<div class="settings-group">
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Route DMs to local runner</span>
					<span class="setting-desc">When you DM the bot, use your active local runner first instead of the cloud pipeline.</span>
				</div>
				<div class="setting-control">
					<label class="runner-option-toggle">
						<input type="checkbox" bind:checked={preferLocalRunnerForDM} />
						<span class="toggle-label">{preferLocalRunnerForDM ? 'On' : 'Off'}</span>
					</label>
				</div>
			</div>
			<div class="setting-item">
				<div class="setting-info">
					<span class="setting-label">Default max retries</span>
					<span class="setting-desc">How many times to retry a failed runner job before giving up (1–20). Screenshot and DM jobs always use 1.</span>
				</div>
				<div class="setting-control">
					<input
						class="input"
						type="number"
						min="1"
						max="20"
						bind:value={defaultMaxAttempts}
						onblur={() => { defaultMaxAttempts = normalizeRunnerMaxAttempts(defaultMaxAttempts); }}
						style="width: 5rem; text-align: center;"
					/>
				</div>
			</div>
			{#if runnerPrefsSaveStatus === 'saving'}
				<p class="runner-pref-status">Saving...</p>
			{:else if runnerPrefsSaveStatus === 'saved'}
				<p class="runner-pref-status saved">Saved ✓</p>
			{:else if runnerPrefsSaveStatus === 'error'}
				<p class="runner-pref-status error">Couldn't save</p>
			{/if}
		</div>
	</section>

	<!-- Automation Hub -->
	<section class="content-section">
		<h2><span class="section-icon">🧭</span> Automation Hub</h2>

		<div class="operations-links">
			<a href="/account/ai-workflows" class="btn btn-outline btn-sm">Open Automation Console</a>
			<a href="/account/ai-workflows#jobs" class="btn btn-outline btn-sm">Open Queue Board</a>
		</div>

		<div class="workflow-panel">
			<div class="workflow-panel-header">
				<h3>Queue Workflows</h3>
				<span class="workflow-count">{workflows.length} total</span>
			</div>
			<p class="workflow-help">Define reusable queue rules so specific job types route to selected runners and instances.</p>

			<div class="workflow-create-grid">
				<input
					class="input"
					type="text"
					placeholder="Workflow name"
					bind:value={newWorkflowName}
					disabled={creatingWorkflow}
				/>
				<input
					class="input"
					type="text"
					placeholder="Description (optional)"
					bind:value={newWorkflowDescription}
					disabled={creatingWorkflow}
				/>
				<select class="input" bind:value={newWorkflowJobType} disabled={creatingWorkflow}>
					<option value="shell_command">shell_command</option>
					<option value="screenshot_capture">screenshot_capture</option>
					<option value="system_profile">system_profile</option>
					<option value="vscode_discover_instances">vscode_discover_instances</option>
					<option value="vscode_send_copilot_message">vscode_send_copilot_message</option>
					<option value="dm">dm</option>
				</select>
				<select class="input" bind:value={newWorkflowTargetTokenId} disabled={creatingWorkflow}>
					<option value="">No target runner</option>
					{#each runnerTokens.filter((token) => !token.revoked) as token (token.id)}
						<option value={token.id}>{token.name} ({token.token_prefix}...)</option>
					{/each}
				</select>
				<button class="btn btn-primary btn-sm" onclick={createWorkflow} disabled={creatingWorkflow || !newWorkflowName.trim()}>
					{creatingWorkflow ? 'Creating…' : 'Create Workflow'}
				</button>
			</div>

			<div class="workflow-dispatch-row">
				<select class="input" bind:value={workflowDispatchId}>
					<option value="">Select workflow to dispatch</option>
					{#each workflows.filter((workflow) => workflow.enabled) as workflow (workflow.id)}
						<option value={workflow.id}>{workflow.name} ({workflow.job_type})</option>
					{/each}
				</select>
				<input class="input" type="text" placeholder="Command override (optional)" bind:value={workflowDispatchCommand} />
				<input class="input" type="text" placeholder="Label override (optional)" bind:value={workflowDispatchLabel} />
				<input class="input" type="text" placeholder="Payload JSON (optional)" bind:value={workflowDispatchPayload} />
				<button class="btn btn-outline btn-sm" onclick={dispatchWorkflowNow} disabled={dispatchingWorkflow || !workflowDispatchId}>
					{dispatchingWorkflow ? 'Queuing…' : 'Run Workflow'}
				</button>
			</div>

			{#if workflows.length > 0}
				<div class="workflow-list">
					{#each workflows as workflow (workflow.id)}
						<div class="workflow-row" class:workflow-disabled={!workflow.enabled}>
							<div class="workflow-main">
								<strong>{workflow.name}</strong>
								<span class="workflow-meta">type: {workflow.job_type}</span>
								<span class="workflow-meta">token: {workflow.target_runner_token_id || 'none'}</span>
								<span class="workflow-meta">instance: {workflow.target_runner_instance_id || 'auto'}</span>
								<span class="workflow-meta">priority: {workflow.priority}, retries: {workflow.max_attempts}, timeout: {workflow.timeout_seconds}s</span>
								{#if workflow.description}
									<span class="workflow-meta">{workflow.description}</span>
								{/if}
							</div>
							<div class="workflow-actions">
								<label class="runner-option-toggle">
									<input
										type="checkbox"
										checked={Boolean(workflow.enabled)}
										onchange={(event) => setWorkflowEnabled(workflow, event.currentTarget.checked)}
									/>
									<span>{workflow.enabled ? 'Enabled' : 'Disabled'}</span>
								</label>
								<button class="btn btn-danger btn-sm" onclick={() => deleteWorkflow(workflow.id)}>Delete</button>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="workflow-empty">No workflows yet. Create one to start routing jobs by policy.</p>
			{/if}
		</div>

		<!-- Token creation -->
		<div class="runner-create-row">
			<input
				class="input runner-name-input"
				type="text"
				placeholder="Runner name (e.g. Home Server)"
				bind:value={newRunnerName}
				onkeydown={(e) => e.key === 'Enter' && createRunner()}
				disabled={creatingRunner}
			/>
			<button class="btn btn-primary btn-sm" onclick={createRunner} disabled={creatingRunner || !newRunnerName.trim()}>
				{creatingRunner ? 'Creating…' : 'Create Runner'}
			</button>
		</div>

		<div class="runner-options-row">
			<label class="runner-option-toggle">
				<input type="checkbox" bind:checked={showRevokedRunners} />
				<span>Show revoked runners</span>
			</label>
		</div>

		<!-- Show raw token once after creation -->
		{#if newRawToken}
			<div class="token-reveal">
				<p class="token-reveal-warning">
					⚠️ Copy this token now — it won't be shown again.
				</p>
				<div class="token-reveal-row">
					<code class="token-reveal-value">{newRawToken}</code>
					<button class="btn btn-outline btn-sm" onclick={copyRawToken}>
						{newRawTokenCopied ? '✓ Copied' : 'Copy'}
					</button>
				</div>
				<p class="token-reveal-hint">
					Add it to your runner config file as <code>SPACEBOT_RUNNER_TOKEN</code>.
				</p>
				<button class="btn btn-sm btn-ghost" onclick={() => newRawToken = null}>Dismiss</button>
			</div>
		{/if}

		<!-- Runners list -->
		{#if runnerTokens.length === 0}
			<div class="empty-state">
				<span class="empty-icon">🖥️</span>
				No runners yet. Create one above and run <code>bun run scripts/local-runner/index.ts</code> on your machine.
			</div>
		{:else if visibleRunnerTokens().length === 0}
			<div class="empty-state">
				<span class="empty-icon">🧹</span>
				All runners are currently hidden by filter. Enable "Show revoked runners" to view them.
			</div>
		{:else}
			<div class="runners-list">
				{#each visibleRunnerTokens() as t (t.id)}
					<div class="runner-card" class:revoked={t.revoked}>
						<div class="runner-card-header">
							<div class="runner-identity">
								<span class="runner-status-dot" class:online={!t.revoked && isRunnerOnline(t)}></span>
								<span class="runner-name">{t.name}</span>
								<code class="runner-prefix">{t.token_prefix}…</code>
							</div>
							<div class="runner-meta">
								{#if t.revoked}
									<span class="status-badge badge-danger">Revoked</span>
									<button class="btn btn-danger btn-sm" onclick={() => deleteRunner(t.id)}>Delete</button>
								{:else if isRunnerOnline(t)}
									<span class="status-badge badge-success">Online</span>
								{:else}
									<span class="status-badge badge-neutral">Offline</span>
								{/if}
								{#if t.last_seen_at}
									<span class="runner-last-seen">Last seen {new Date(t.last_seen_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
								{/if}
								{#if !t.revoked}
									<button class="btn btn-outline btn-sm" onclick={() => dispatchTokenId = dispatchTokenId === t.id ? null : t.id}>
										{dispatchTokenId === t.id ? 'Cancel' : 'Dispatch'}
									</button>
									<button class="btn btn-danger btn-sm" onclick={() => revokeRunner(t.id)}>Revoke</button>
								{/if}
							</div>
						</div>

						{#if instancesForToken(t.id).length > 0}
							<div class="runner-instances">
								{#each instancesForToken(t.id) as inst (inst.id)}
									<div class="runner-instance-row">
										<div class="runner-instance-main">
											<strong>{inst.display_name}</strong>
											<span class="runner-instance-meta">system: {getRunnerSystemSummary(inst)}</span>
											<span class="runner-instance-meta">permissions: {getRunnerPermissionsSummary(inst)}</span>
											<span class="runner-instance-meta">screenshots: {getRunnerCapabilityState(inst, 'screenshotAvailable')}</span>
											<span class="runner-instance-meta">vscode: {getRunnerCapabilityState(inst, 'vscodeControlAvailable')}</span>
											<span class="runner-instance-meta">copilot chat: {getCopilotAvailability(inst)}</span>
											<span class="runner-instance-meta">copilot config: {getCopilotConfigSummary(inst)}</span>
											<span class="runner-instance-meta">provider: {providerLabel(inst)}</span>
											<span class="runner-instance-meta">model: {modelLabel(inst)}</span>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Inline dispatch form -->
						{#if dispatchTokenId === t.id}
							<div class="dispatch-form">
								<input
									class="input"
									type="text"
									placeholder="Shell command (e.g. bash ~/scripts/deploy.sh)"
									bind:value={dispatchCommand}
								/>
								<input
									class="input"
									type="text"
									placeholder="Working directory (optional)"
									bind:value={dispatchWorkDir}
								/>
								<input
									class="input"
									type="text"
									placeholder="Label (optional)"
									bind:value={dispatchLabel}
								/>
								<div class="dispatch-actions">
									<button class="btn btn-primary btn-sm" onclick={dispatchJob} disabled={dispatching || !dispatchCommand.trim()}>
										{dispatching ? 'Queuing…' : 'Queue Job'}
									</button>
									<input
										class="input"
										type="text"
										placeholder="Send to Copilot (requires bridge)"
										bind:value={copilotPrompt}
									/>
									<button
										class="btn btn-outline btn-sm"
										onclick={() => queueTypedJob(t.id, 'vscode_send_copilot_message', { message: copilotPrompt }, 'Send Copilot Message')}
										disabled={dispatching || !copilotPrompt.trim()}
									>
										Send to Copilot
									</button>
									<button class="btn btn-ghost btn-sm" onclick={() => dispatchTokenId = null}>Cancel</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="runner-jobs-link">
			<a href="/account/ai-jobs" class="btn btn-outline btn-sm">View all jobs →</a>
		</div>
	</section>
</div>

<style>
	.runners-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-decoration: none;
		margin-bottom: 0.75rem;
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}

	.header-icon {
		font-size: 1.25rem;
	}

	.header-desc {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0.25rem 0 0;
	}

	.content-section {
		margin-bottom: 2.5rem;
	}

	.content-section h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.section-icon {
		font-size: 1rem;
	}

	/* Settings */
	.settings-group {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.25rem 0;
		margin-bottom: 1rem;
	}

	.setting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1.25rem;
	}

	.setting-item + .setting-item {
		border-top: 1px solid var(--color-border);
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.setting-label {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.setting-desc {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.setting-control {
		flex-shrink: 0;
	}

	/* Runner prefs save status */
	.runner-pref-status {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0 0 0.5rem 1.25rem;
	}

	.runner-pref-status.saved {
		color: var(--color-success);
	}

	.runner-pref-status.error {
		color: var(--color-danger, #dc2626);
	}

	/* Operations links */
	.operations-links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0 0 1rem;
	}

	/* Workflow panel */
	.workflow-panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.875rem 1rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.workflow-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.workflow-panel-header h3 {
		font-size: 0.9375rem;
		margin: 0;
	}

	.workflow-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.workflow-help {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.workflow-create-grid,
	.workflow-dispatch-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 0.5rem;
	}

	.workflow-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.workflow-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.workflow-row.workflow-disabled {
		opacity: 0.65;
	}

	.workflow-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.workflow-meta,
	.workflow-empty {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.workflow-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* Runner creation */
	.runner-create-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.runner-name-input {
		flex: 1;
	}

	.runner-options-row {
		display: flex;
		align-items: center;
		margin-bottom: 0.875rem;
	}

	.runner-option-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* Token reveal */
	.token-reveal {
		background: hsla(38, 92%, 50%, 0.08);
		border: 1px solid hsla(38, 92%, 50%, 0.3);
		border-radius: var(--radius-md);
		padding: 1rem 1.25rem;
		margin-bottom: 1.25rem;
	}

	.token-reveal-warning {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-warning);
		margin: 0 0 0.625rem;
	}

	.token-reveal-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.token-reveal-value {
		flex: 1;
		font-family: monospace;
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.375rem 0.625rem;
		word-break: break-all;
		color: var(--color-text);
	}

	.token-reveal-hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0 0 0.625rem;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	/* Runners list */
	.runners-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		margin-bottom: 1.5rem;
	}

	.runner-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.875rem 1rem;
		transition: border-color var(--transition-fast);
	}

	.runner-card:hover {
		border-color: var(--color-primary);
	}

	.runner-card.revoked {
		opacity: 0.6;
		border-color: var(--color-border);
	}

	.runner-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.runner-identity {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.runner-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-muted);
		flex-shrink: 0;
	}

	.runner-status-dot.online {
		background: var(--color-success);
		box-shadow: 0 0 0 3px hsla(142, 71%, 45%, 0.2);
	}

	.runner-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.runner-prefix {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.runner-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.runner-last-seen {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.runner-instances {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.runner-instance-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated, hsla(var(--hue), 25%, 96%, 0.2));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.runner-instance-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.runner-instance-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Dispatch form */
	.dispatch-form {
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dispatch-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* Job history link */
	.runner-jobs-link {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	/* Status badges */
	.status-badge {
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge-success {
		background: hsla(142, 71%, 45%, 0.12);
		color: var(--color-success);
	}

	.badge-danger {
		background: hsla(0, 84%, 60%, 0.12);
		color: var(--color-danger);
	}

	.badge-neutral {
		background: var(--color-surface-hover, hsla(var(--hue), 10%, 50%, 0.1));
		color: var(--color-text-muted);
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		border: none;
		transition: all var(--transition-fast);
	}

	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.btn-primary {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}

	.btn-primary:hover {
		background: var(--color-primary-button-hover);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-outline {
		background: transparent;
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
	}

	.btn-outline:hover {
		background: var(--color-primary-soft);
	}

	.btn-outline:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger {
		background: var(--color-danger);
		color: white;
	}

	.btn-danger:hover {
		opacity: 0.9;
	}

	.btn-ghost {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
	}

	.btn-ghost:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	/* Input */
	.input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		color: var(--color-text);
		outline: none;
		transition: border-color var(--transition-fast);
		box-sizing: border-box;
	}

	.input:focus {
		border-color: var(--color-primary);
	}

	.input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.runners-page {
			padding: 1rem 0.75rem 2rem;
		}

		.header-content h1 {
			font-size: 1.25rem;
		}

		.setting-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.runner-card-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
