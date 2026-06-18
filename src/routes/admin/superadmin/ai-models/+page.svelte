<script lang="ts">
	let { data: incomingData } = $props();

	let catalog = $state([]);
	let syncedAt = $state(null);
	let stale = $state(false);
	let source = $state("cache");
	let warning = $state(null);
	let selection = $state(null);
	const envModel = $derived(incomingData?.defaults?.envModel ?? null);

	let selectedModelIds = $state([]);
	let primaryModelId = $state(null);
	let routingStrategy = $state("fallback");

	$effect(() => {
		const incomingSelection = incomingData?.selection ?? null;
		catalog = incomingData?.catalog ?? [];
		syncedAt = incomingData?.syncedAt ?? null;
		stale = incomingData?.stale ?? false;
		source = incomingData?.source ?? "cache";
		warning = incomingData?.warning ?? null;
		selection = incomingSelection;
		selectedModelIds = [...(incomingSelection?.selectedModelIds ?? [])];
		primaryModelId = incomingSelection?.primaryModelId ?? null;
		routingStrategy = incomingSelection?.routingStrategy ?? "fallback";
	});

	let search = $state("");
	let taskFilter = $state("all");
	let sortBy = $state("stability");
	let showBetaOnly = $state(false);
	let showStableOnly = $state(false);

	let syncing = $state(false);
	let saving = $state(false);
	let toast = $state(null);

	function applyBetaOnly(checked) {
		showBetaOnly = checked;
		if (checked) showStableOnly = false;
		search = "";
	}

	function applyStableOnly(checked) {
		showStableOnly = checked;
		if (checked) showBetaOnly = false;
		search = "";
	}

	function showToast(message, type = "info") {
		toast = { message, type };
		setTimeout(() => {
			toast = null;
		}, 3500);
	}

	const allTasks = $derived.by(() => {
		const taskSet = new Set();
		for (const m of catalog) {
			for (const t of m.tasks ?? []) taskSet.add(t);
		}
		return Array.from(taskSet).sort();
	});

	const filteredModels = $derived.by(() => {
		let models = catalog.filter((m) => {
			if (showBetaOnly && !m.isBeta) return false;
			if (showStableOnly && (m.isBeta || m.isDeprecated || m.isExperimental)) return false;
			if (taskFilter !== "all" && !(m.tasks ?? []).includes(taskFilter)) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				const searchable = [m.name, m.id, m.description, m.author, ...(m.tags ?? [])].join(" ").toLowerCase();
				if (!searchable.includes(q)) return false;
			}
			return true;
		});

		if (sortBy === "name") {
			models = models.sort((a, b) => a.name.localeCompare(b.name));
		} else if (sortBy === "author") {
			models = models.sort((a, b) => a.author.localeCompare(b.author) || a.name.localeCompare(b.name));
		} else {
			// stability: stable first, then beta, then deprecated
			models = models.sort((a, b) => {
				const score = (m) => (m.isDeprecated ? 2 : m.isBeta || m.isExperimental ? 1 : 0);
				return score(a) - score(b) || a.name.localeCompare(b.name);
			});
		}

		return models;
	});

	const selectedCount = $derived(selectedModelIds.length);
	const betaCount = $derived(catalog.filter((m) => m.isBeta).length);
	const deprecatingCount = $derived(catalog.filter((m) => m.isDeprecated).length);

	function toggleModel(modelId) {
		if (selectedModelIds.includes(modelId)) {
			selectedModelIds = selectedModelIds.filter((id) => id !== modelId);
			if (primaryModelId === modelId) {
				primaryModelId = selectedModelIds[0] ?? null;
			}
		} else {
			selectedModelIds = [...selectedModelIds, modelId];
			if (!primaryModelId) primaryModelId = modelId;
		}
	}

	function setPrimary(modelId) {
		if (!selectedModelIds.includes(modelId)) {
			selectedModelIds = [...selectedModelIds, modelId];
		}
		primaryModelId = modelId;
	}

	async function refreshCatalog(force = false) {
		syncing = true;
		try {
			const url = `/api/superadmin/workers-ai/models${force ? "?force=1" : ""}`;
			const res = await fetch(url);
			const json = await res.json();
			if (!json.success) throw new Error(json.error || "Unknown error");
			catalog = json.models ?? [];
			syncedAt = json.syncedAt ?? null;
			stale = json.stale ?? false;
			source = json.source ?? "cloudflare";
			warning = json.warning ?? null;
			showToast(`Catalog refreshed — ${catalog.length} model(s) loaded`, "success");
		} catch (err) {
			showToast(`Sync failed: ${err.message}`, "error");
		} finally {
			syncing = false;
		}
	}

	async function saveSelection() {
		saving = true;
		try {
			const res = await fetch("/api/superadmin/workers-ai/models", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ selectedModelIds, primaryModelId, routingStrategy }),
			});
			const json = await res.json();
			if (!json.success) throw new Error(json.error || "Unknown error");
			selection = json.selection;
			showToast("Selection saved successfully", "success");
		} catch (err) {
			showToast(`Save failed: ${err.message}`, "error");
		} finally {
			saving = false;
		}
	}

	function badgeForCost(model) {
		const pricing = model?.pricing;
		if (!pricing) return null;
		const has = (k) => pricing[k] !== undefined;
		if (has("per_request") && pricing.per_request === 0) return { label: "Free", class: "badge-free" };
		if (has("per_request") || has("per_1k_tokens") || has("per_token")) return { label: "Paid", class: "badge-paid" };
		return null;
	}
</script>

<div class="page">
	<div class="hero">
		<div class="hero-text">
			<h1>Workers AI Models</h1>
			<p>Browse and select which models SpaceBot uses for AI inference. Changes take effect immediately.</p>
		</div>
		<div class="hero-actions">
			<button class="btn btn-secondary" onclick={() => refreshCatalog(true)} disabled={syncing}>
				{syncing ? "Syncing…" : "Sync From Cloudflare"}
			</button>
			<button class="btn btn-primary" onclick={saveSelection} disabled={saving || selectedCount === 0}>
				{saving ? "Saving…" : `Save Selection (${selectedCount})`}
			</button>
		</div>
	</div>

	{#if warning}
		<div class="alert alert-warning">{warning}</div>
	{/if}

	{#if toast}
		<div class="toast toast-{toast.type}">{toast.message}</div>
	{/if}

	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-label">Total Models</span>
			<span class="stat-value">{catalog.length}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">BETA Models</span>
			<span class="stat-value">{betaCount}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">Deprecating</span>
			<span class="stat-value">{deprecatingCount}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">Selected</span>
			<span class="stat-value">{selectedCount}</span>
		</div>
	</div>

	<div class="meta-row">
		<span class="meta-item">
			<span class="meta-key">Last Updated:</span>
			<span class="meta-val">{syncedAt ? new Date(syncedAt).toLocaleString() : "Never"}</span>
		</span>
		<span class="meta-item">
			<span class="meta-key">Source:</span>
			<span class="meta-val">{source}</span>
		</span>
		{#if stale}
			<span class="badge badge-warn">Catalog Stale</span>
		{/if}
		{#if envModel}
			<span class="meta-item">
				<span class="meta-key">Env Fallback:</span>
				<span class="meta-val mono">{envModel}</span>
			</span>
		{/if}
	</div>

	<div class="selection-panel">
		<h2>Active Selection</h2>
		<div class="selection-row">
			<label class="field-label">
				Routing Strategy
				<select bind:value={routingStrategy} class="select">
					<option value="fallback">Fallback (try in order)</option>
					<option value="round_robin">Round Robin (rotate by minute)</option>
				</select>
			</label>
			<label class="field-label">
				Primary Model
				<select bind:value={primaryModelId} class="select">
					{#if selectedModelIds.length === 0}
						<option value={null} disabled>No models selected</option>
					{:else}
						{#each selectedModelIds as id}
							<option value={id}>{id}</option>
						{/each}
					{/if}
				</select>
			</label>
		</div>
		{#if selectedCount > 0}
			<div class="selected-chips">
				{#each selectedModelIds as id}
					<span class="chip" class:chip-primary={id === primaryModelId}>
						{id}
						{#if id === primaryModelId}<span class="chip-tag">PRIMARY</span>{/if}
						<button class="chip-remove" onclick={() => toggleModel(id)} aria-label="Remove {id}">×</button>
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<div class="filter-bar">
		<input class="search-input" type="search" placeholder="Search models…" bind:value={search} />
		<select class="select" bind:value={taskFilter}>
			<option value="all">All Tasks</option>
			{#each allTasks as task}
				<option value={task}>{task}</option>
			{/each}
		</select>
		<select class="select" bind:value={sortBy}>
			<option value="stability">Sort: Stability</option>
			<option value="name">Sort: Name</option>
			<option value="author">Sort: Author</option>
		</select>
		<label class="checkbox-label">
			<input
				type="checkbox"
				checked={showBetaOnly}
				onchange={(event) => applyBetaOnly(event.currentTarget.checked)}
			/> BETA only
		</label>
		<label class="checkbox-label">
			<input
				type="checkbox"
				checked={showStableOnly}
				onchange={(event) => applyStableOnly(event.currentTarget.checked)}
			/> Stable only
		</label>
	</div>

	<p class="result-count">{filteredModels.length} of {catalog.length} models shown</p>

	<div class="model-grid">
		{#each filteredModels as model (model.id)}
			{@const isSelected = selectedModelIds.includes(model.id)}
			{@const isPrimary = model.id === primaryModelId}
			{@const costBadge = badgeForCost(model)}
			<div class="model-card" class:selected={isSelected} class:is-primary={isPrimary}>
				<div class="card-header">
					<div class="card-title-row">
						<span class="model-name">{model.name}</span>
						<span class="author-chip">{model.author}</span>
					</div>
					<div class="card-badges">
						{#if model.isBeta || model.isExperimental}
							<span class="badge badge-beta">BETA</span>
						{/if}
						{#if model.isDeprecated}
							<span class="badge badge-deprecated">PLANNED DEPRECATION</span>
						{/if}
						{#if costBadge}
							<span class="badge {costBadge.class}">{costBadge.label}</span>
						{/if}
					</div>
				</div>

				<p class="model-id mono">{model.id}</p>

				{#if model.description}
					<p class="model-desc">{model.description}</p>
				{/if}

				{#if (model.tasks ?? []).length > 0}
					<div class="task-tags">
						{#each model.tasks as task}
							<span class="task-tag">{task}</span>
						{/each}
					</div>
				{/if}

				<div class="card-actions">
					<label class="checkbox-label">
						<input type="checkbox" checked={isSelected} onchange={() => toggleModel(model.id)} />
						Select
					</label>
					<label class="checkbox-label" class:disabled={!isSelected}>
						<input
							type="radio"
							name="primary-model"
							value={model.id}
							checked={isPrimary}
							onchange={() => setPrimary(model.id)}
							disabled={!isSelected}
						/>
						Primary
					</label>
					{#if model.contextWindow}
						<span class="context-window">{(model.contextWindow / 1000).toFixed(0)}K ctx</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#if filteredModels.length === 0 && catalog.length > 0}
		<p class="empty-state">No models match the current filters.</p>
	{/if}

	{#if catalog.length === 0}
		<div class="empty-catalog">
			<p>No model catalog loaded.</p>
			<button class="btn btn-primary" onclick={() => refreshCatalog(true)} disabled={syncing}>
				{syncing ? "Syncing…" : "Sync From Cloudflare"}
			</button>
		</div>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.hero h1 {
		margin: 0 0 0.25rem;
		font-size: 1.6rem;
	}

	.hero p {
		margin: 0;
		color: var(--text-muted, #888);
		font-size: 0.9rem;
	}

	.hero-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn {
		padding: 0.45rem 1rem;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: opacity 0.15s;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--color-primary-button, #4f46e5);
		color: var(--color-primary-button-text, #fff);
	}

	.btn-secondary {
		background: var(--color-surface-elevated, #f3f4f6);
		color: var(--color-text, #111827);
		border: 1px solid var(--color-border, #d1d5db);
	}

	.alert-warning {
		padding: 0.75rem 1rem;
		background: rgba(234, 179, 8, 0.12);
		border: 1px solid rgba(234, 179, 8, 0.4);
		border-radius: 6px;
		color: #d4a600;
		font-size: 0.875rem;
	}

	.toast {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		padding: 0.75rem 1.25rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		z-index: 9999;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.toast-success { background: #16a34a; color: var(--color-fixed-text-bright); }
	.toast-error { background: #dc2626; color: var(--color-fixed-text-bright); }
	.toast-info {
		background: var(--color-surface-elevated, #f3f4f6);
		color: var(--color-text, #111827);
		border: 1px solid var(--color-border, #d1d5db);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.75rem;
	}

	.stat-card {
		background: var(--color-surface, #ffffff);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-label { font-size: 0.75rem; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.05em; }
	.stat-value { font-size: 1.5rem; font-weight: 700; }

	.meta-row {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
		align-items: center;
		font-size: 0.8rem;
		color: var(--text-muted, #888);
	}

	.meta-item { display: flex; gap: 0.35rem; }
	.meta-key { font-weight: 600; }
	.meta-val { color: var(--color-text, #111827); }
	.mono { font-family: monospace; font-size: 0.8em; }

	.badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.badge-beta { background: rgba(234, 179, 8, 0.15); color: #d4a600; border: 1px solid rgba(234, 179, 8, 0.35); }
	.badge-deprecated { background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
	.badge-warn { background: rgba(234, 179, 8, 0.12); color: #d4a600; border: 1px solid rgba(234, 179, 8, 0.3); }
	.badge-free { background: rgba(34, 197, 94, 0.12); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
	.badge-paid { background: rgba(99, 102, 241, 0.12); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); }

	.selection-panel {
		background: var(--color-surface, #ffffff);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 8px;
		padding: 1rem;
	}

	.selection-panel h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}

	.selection-row {
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.field-label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--text-muted, #888);
	}

	.select {
		background: var(--color-surface-elevated, #f3f4f6);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 6px;
		color: var(--color-text, #111827);
		padding: 0.35rem 0.6rem;
		font-size: 0.875rem;
		min-width: 200px;
	}

	.selected-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--color-surface-elevated, #f3f4f6);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 99px;
		padding: 0.2rem 0.5rem 0.2rem 0.75rem;
		font-size: 0.75rem;
		font-family: monospace;
	}

	.chip-primary {
		border-color: var(--color-primary, #5865f2);
		background: var(--color-primary-soft, rgba(88, 101, 242, 0.1));
	}

	.chip-tag {
		font-size: 0.6rem;
		font-weight: 700;
		background: var(--color-primary-button, #4f46e5);
		color: var(--color-fixed-text-bright);
		border-radius: 99px;
		padding: 0.1rem 0.35rem;
		font-family: sans-serif;
	}

	.chip-remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-muted, #888);
		font-size: 1rem;
		padding: 0 0.1rem;
		line-height: 1;
	}

	.chip-remove:hover { color: #f87171; }

	.filter-bar {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
		background: var(--color-surface, #ffffff);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 6px;
		color: var(--color-text, #111827);
		padding: 0.4rem 0.75rem;
		font-size: 0.875rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.checkbox-label.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.result-count {
		font-size: 0.8rem;
		color: var(--text-muted, #888);
		margin: 0;
	}

	.model-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.75rem;
	}

	.model-card {
		background: var(--color-surface, #ffffff);
		border: 1px solid var(--color-border, #d1d5db);
		border-radius: 8px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: border-color 0.15s;
	}

	.model-card.selected {
		border-color: var(--color-primary, #5865f2);
	}

	.model-card.is-primary {
		border-color: var(--color-primary, #5865f2);
		box-shadow: 0 0 0 1px var(--color-primary, #5865f2);
	}

	.card-header {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.card-title-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.model-name {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.author-chip {
		font-size: 0.7rem;
		background: var(--color-surface-elevated, #f3f4f6);
		color: var(--text-muted, #888);
		border-radius: 99px;
		padding: 0.1rem 0.5rem;
	}

	.card-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.model-id {
		font-size: 0.72rem;
		color: var(--text-muted, #888);
		margin: 0;
		word-break: break-all;
	}

	.model-desc {
		font-size: 0.8rem;
		color: var(--text-muted, #aaa);
		margin: 0;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.task-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.task-tag {
		font-size: 0.68rem;
		background: var(--color-surface-elevated, #f3f4f6);
		color: var(--text-muted, #999);
		border-radius: 4px;
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--color-border, #d1d5db);
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: auto;
		padding-top: 0.25rem;
		border-top: 1px solid var(--color-border, #d1d5db);
	}

	.context-window {
		font-size: 0.72rem;
		color: var(--text-muted, #888);
		margin-left: auto;
	}

	.empty-state {
		text-align: center;
		color: var(--text-muted, #888);
		font-size: 0.9rem;
		padding: 2rem 0;
	}

	.empty-catalog {
		text-align: center;
		padding: 3rem 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		color: var(--text-muted, #888);
	}
</style>
