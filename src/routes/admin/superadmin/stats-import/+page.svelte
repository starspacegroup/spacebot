<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	const servers = $derived(data?.servers ?? []);

	let selectedGuildId = $state('');
	let importing = $state(false);
	let importResult = $state(null);
	let importError = $state(null);
	let dragOver = $state(false);
	let fileInput = $state(null);

	$effect(() => {
		if (!selectedGuildId && servers.length > 0) {
			selectedGuildId = servers[0].guild_id;
		}
	});

	function resetImport() {
		importResult = null;
		importError = null;
		if (fileInput) fileInput.value = '';
	}

	async function handleFileSelect(event) {
		const file = event.target.files?.[0];
		if (file) await importFile(file);
	}

	async function handleDrop(event) {
		event.preventDefault();
		dragOver = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) await importFile(file);
	}

	function handleDragOver(event) {
		event.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	async function importFile(file) {
		if (!selectedGuildId) {
			importError = 'Choose a target server first.';
			return;
		}

		if (!file.name.endsWith('.json')) {
			importError = 'Please select a .json file';
			return;
		}

		importing = true;
		importError = null;
		importResult = null;

		try {
			const text = await file.text();
			let parsed;

			try {
				parsed = JSON.parse(text);
			} catch {
				importError = 'Invalid JSON file. Please check the file format.';
				importing = false;
				return;
			}

			if (parsed.format !== 'spacebot-stats') {
				importError = 'This page only accepts SpaceBot stats export files.';
				importing = false;
				return;
			}

			const response = await fetch(`/api/stats/${selectedGuildId}/import`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: text,
			});

			const result = await response.json();

			if (response.ok) {
				importResult = result;
				await invalidateAll();
			} else {
				importError = result.error || 'Import failed';
			}
		} catch (error) {
			importError = `Import failed: ${error.message}`;
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}

	function selectedServerName() {
		return servers.find((server) => server.guild_id === selectedGuildId)?.name || selectedGuildId;
	}
</script>

<svelte:head>
	<title>Stats Import | Superadmin | SpaceBot</title>
</svelte:head>

<div class="stats-import-page">
	<header class="page-header">
		<div class="header-text">
			<h1>
				<span class="header-icon">📥</span>
				Stats Import
			</h1>
			<p class="header-subtitle">Restore exported stats data into any server as a superadmin</p>
		</div>
	</header>

	<section class="section-card">
		<div class="form-group">
			<label for="target-server">Target server</label>
			<select id="target-server" bind:value={selectedGuildId} disabled={importing || servers.length === 0}>
				<option value="" disabled>Select a server</option>
				{#each servers as server}
					<option value={server.guild_id}>{server.name} ({server.guild_id})</option>
				{/each}
			</select>
		</div>

		{#if !importResult}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop-zone {dragOver ? 'drag-over' : ''}"
				ondrop={handleDrop}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
			>
				{#if importing}
					<div class="importing-state">
						<div class="spinner"></div>
						<p>Importing stats...</p>
					</div>
				{:else}
					<div class="drop-zone-content">
						<span class="drop-icon">📊</span>
						<p>Drag & drop a stats export file here</p>
						<p class="drop-or">or</p>
						<label class="btn btn-primary btn-sm file-select-btn">
							Choose File
							<input
								bind:this={fileInput}
								type="file"
								accept=".json"
								onchange={handleFileSelect}
								hidden
							>
						</label>
					</div>
				{/if}
			</div>

			{#if importError}
				<div class="import-error">
					<span>❌</span> {importError}
				</div>
			{/if}

			<div class="import-notes">
				<h4>Notes:</h4>
				<ul>
					<li>Only accepts individual SpaceBot stats export files</li>
					<li>Duplicate rows are skipped automatically during import</li>
					<li>Choose the destination server carefully before importing</li>
				</ul>
			</div>
		{:else}
			<div class="import-results">
				<div class="result-summary success">
					<span class="result-icon">✅</span>
					<p>{importResult.message}</p>
				</div>

				<div class="result-card">
					<h4>Imported Into</h4>
					<p>{selectedServerName()}</p>
				</div>

				<div class="stats-import-results">
					<div class="stats-import-row">
						<span class="stats-import-label">Server snapshots:</span>
						<span>{importResult.results.server_stats?.imported || 0} / {importResult.results.server_stats?.total || 0}</span>
					</div>
					<div class="stats-import-row">
						<span class="stats-import-label">Aggregated periods:</span>
						<span>{importResult.results.aggregated_stats?.imported || 0} / {importResult.results.aggregated_stats?.total || 0}</span>
					</div>
					<div class="stats-import-row">
						<span class="stats-import-label">Voice sessions:</span>
						<span>{importResult.results.voice_sessions?.imported || 0} / {importResult.results.voice_sessions?.total || 0}</span>
					</div>
				</div>

				<div class="result-actions">
					<a href="/admin/{selectedGuildId}/stats" class="btn btn-secondary">Go to Stats</a>
					<button class="btn btn-primary" onclick={resetImport}>Import Another</button>
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.stats-import-page {
		max-width: 860px;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.25rem;
		font-size: 1.75rem;
	}

	.header-icon {
		font-size: 1.4rem;
	}

	.header-subtitle {
		margin: 0;
		color: var(--color-text-muted);
	}

	.section-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
	}

	.form-group select {
		width: 100%;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated, var(--color-surface));
		color: var(--color-text);
	}

	.drop-zone {
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem 1rem;
		text-align: center;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}

	.drop-zone.drag-over {
		border-color: var(--color-primary);
		background: var(--color-accent-soft);
	}

	.drop-zone-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.drop-icon {
		font-size: 2rem;
	}

	.drop-or {
		color: var(--color-text-muted);
		margin: 0;
	}

	.importing-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.spinner {
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		animation: spin 0.9s linear infinite;
	}

	.import-error {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger, #d9534f) 14%, transparent);
		color: var(--color-text);
	}

	.import-notes {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: var(--radius-md);
		background: var(--color-surface-hover);
	}

	.import-notes h4 {
		margin: 0 0 0.5rem;
	}

	.import-notes ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.import-results {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.result-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-success, #2e8b57) 16%, transparent);
	}

	.result-summary p,
	.result-card p {
		margin: 0;
	}

	.result-card,
	.stats-import-results {
		padding: 1rem;
		border-radius: var(--radius-md);
		background: var(--color-surface-hover);
	}

	.result-card h4 {
		margin: 0 0 0.35rem;
	}

	.stats-import-results {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.stats-import-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.stats-import-label {
		color: var(--color-text-muted);
	}

	.result-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>