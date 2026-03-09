<script>
	import { invalidateAll } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	
	let { data } = $props();
	
	const selectedGuildId = $derived(data.selectedGuildId);
	
	// ── Export state ──────────────────────────────────────
	let selectedAutomations = $state(new Set());
	let selectedCommands = $state(new Set());
	let exporting = $state(false);
	let exportToast = $state(null);
	
	const automationCount = $derived(data.automations?.length || 0);
	const commandCount = $derived(data.commands?.length || 0);
	
	function toggleAutomation(id) {
		const next = new Set(selectedAutomations);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedAutomations = next;
	}
	
	function toggleAllAutomations() {
		if (selectedAutomations.size === automationCount) {
			selectedAutomations = new Set();
		} else {
			selectedAutomations = new Set(data.automations.map(a => a.public_id || a.id));
		}
	}
	
	function toggleCommand(id) {
		const next = new Set(selectedCommands);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedCommands = next;
	}
	
	function toggleAllCommands() {
		if (selectedCommands.size === commandCount) {
			selectedCommands = new Set();
		} else {
			selectedCommands = new Set(data.commands.map(c => String(c.id)));
		}
	}
	
	async function exportAutomations(all = false) {
		exporting = true;
		try {
			let url = `/api/automations/${selectedGuildId}/export`;
			if (!all && selectedAutomations.size > 0) {
				url += `?ids=${[...selectedAutomations].join(',')}`;
			}
			const response = await fetch(url);
			if (!response.ok) {
				const d = await response.json();
				throw new Error(d.error || 'Export failed');
			}
			const d = await response.json();
			downloadJson(d, `spacebot-automations-export.json`);
			exportToast = { message: `Exported ${d.count} automation${d.count !== 1 ? 's' : ''}`, success: true };
		} catch (error) {
			exportToast = { message: `Export failed: ${error.message}`, success: false };
		} finally {
			exporting = false;
		}
	}
	
	async function exportCommands(all = false) {
		exporting = true;
		try {
			let url = `/api/commands/${selectedGuildId}/export`;
			if (!all && selectedCommands.size > 0) {
				url += `?ids=${[...selectedCommands].join(',')}`;
			}
			const response = await fetch(url);
			if (!response.ok) {
				const d = await response.json();
				throw new Error(d.error || 'Export failed');
			}
			const d = await response.json();
			downloadJson(d, `spacebot-commands-export.json`);
			exportToast = { message: `Exported ${d.count} command${d.count !== 1 ? 's' : ''}`, success: true };
		} catch (error) {
			exportToast = { message: `Export failed: ${error.message}`, success: false };
		} finally {
			exporting = false;
		}
	}
	
	// ── Stats export ─────────────────────────────────────
	const totalStatsRecords = $derived(
		(data.statsCounts?.server_stats || 0) +
		(data.statsCounts?.aggregated_stats || 0) +
		(data.statsCounts?.voice_sessions || 0)
	);
	
	async function exportStats() {
		exporting = true;
		try {
			const response = await fetch(`/api/stats/${selectedGuildId}/export`);
			if (!response.ok) {
				const d = await response.json();
				throw new Error(d.error || 'Export failed');
			}
			const d = await response.json();
			const total = (d.counts?.server_stats || 0) + (d.counts?.aggregated_stats || 0) + (d.counts?.voice_sessions || 0);
			downloadJson(d, `spacebot-stats-export.json`);
			exportToast = { message: `Exported ${total} stats record${total !== 1 ? 's' : ''}`, success: true };
		} catch (error) {
			exportToast = { message: `Export failed: ${error.message}`, success: false };
		} finally {
			exporting = false;
		}
	}
	
	// ── Export all ──────────────────────────────────────
	const totalExportableItems = $derived(automationCount + commandCount + totalStatsRecords);
	
	async function exportAll() {
		exporting = true;
		try {
			const response = await fetch(`/api/export/${selectedGuildId}`);
			if (!response.ok) {
				const d = await response.json();
				throw new Error(d.error || 'Export failed');
			}
			const d = await response.json();
			const counts = d.counts || {};
			const parts = [];
			if (counts.automations) parts.push(`${counts.automations} automation${counts.automations !== 1 ? 's' : ''}`);
			if (counts.commands) parts.push(`${counts.commands} command${counts.commands !== 1 ? 's' : ''}`);
			const statsTotal = (counts.server_stats || 0) + (counts.aggregated_stats || 0) + (counts.voice_sessions || 0);
			if (statsTotal) parts.push(`${statsTotal} stats record${statsTotal !== 1 ? 's' : ''}`);
			downloadJson(d, `spacebot-backup.json`);
			exportToast = { message: `Exported ${parts.join(', ') || 'backup'}`, success: true };
		} catch (error) {
			exportToast = { message: `Export failed: ${error.message}`, success: false };
		} finally {
			exporting = false;
		}
	}
	
	function downloadJson(data, filename) {
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
	
	// ── Import state ──────────────────────────────────────
	let importing = $state(false);
	let importResult = $state(null);
	let importError = $state(null);
	let dragOver = $state(false);
	let fileInput = $state(null);
	
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
			
			// Determine type from format field
			let type;
			let apiPath;
			if (parsed.format === 'spacebot-automations') {
				type = 'automations';
				apiPath = `/api/automations/${selectedGuildId}/import`;
			} else if (parsed.format === 'spacebot-commands') {
				type = 'commands';
				apiPath = `/api/commands/${selectedGuildId}/import`;
			} else if (parsed.format === 'spacebot-stats') {
				type = 'stats';
				apiPath = `/api/stats/${selectedGuildId}/import`;
			} else if (parsed.format === 'spacebot-backup') {
				type = 'backup';
				apiPath = `/api/import/${selectedGuildId}`;
			} else {
				importError = "Invalid file format. This doesn't appear to be a SpaceBot export file.";
				importing = false;
				return;
			}
			
			const response = await fetch(apiPath, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: text,
			});
			
			const result = await response.json();
			
			if (response.ok || response.status === 207) {
				importResult = { ...result, type };
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
</script>

<svelte:head>
	<title>Import & Export | SpaceBot Admin</title>
</svelte:head>

<div class="import-export-page">
	{#if exportToast}
		<Toast 
			message={exportToast.message} 
			success={exportToast.success} 
			onDismiss={() => exportToast = null} 
		/>
	{/if}
	
	<a href="/admin/{selectedGuildId}" class="back-link">← Back to Dashboard</a>
	
	<header class="page-header">
		<div class="header-content">
			<h1>
				<span class="header-icon">📦</span>
				Import & Export
			</h1>
			<p class="header-subtitle">Share automations, commands, and stats data between servers or back them up</p>
		</div>
	</header>
	
	<!-- Export Section -->
	<section class="section-card">
		<div class="section-header">
			<h2><span class="section-icon">📤</span> Export</h2>
			<p class="section-desc">Download automations, commands, or stats as a JSON file to share or back up</p>
		</div>
		
		<!-- Export All -->
		{#if totalExportableItems > 0}
			<div class="export-all-bar">
				<div class="export-all-info">
					<span class="export-all-icon">💾</span>
					<div>
						<strong>Full Backup</strong>
						<span class="export-all-desc">Export everything in one file — automations, commands, settings & stats</span>
					</div>
				</div>
				<button 
					class="btn btn-primary" 
					disabled={exporting} 
					onclick={exportAll}
				>
					Export All Data
				</button>
			</div>
		{/if}
		
		<!-- Automations Export -->
		<div class="export-group">
			<div class="export-group-header">
				<h3>⚡ Automations</h3>
				{#if automationCount > 0}
					<div class="export-group-actions">
						<button 
							class="btn btn-sm btn-secondary" 
							disabled={exporting || selectedAutomations.size === 0} 
							onclick={() => exportAutomations(false)}
						>
							Export Selected ({selectedAutomations.size})
						</button>
						<button 
							class="btn btn-sm btn-primary" 
							disabled={exporting} 
							onclick={() => exportAutomations(true)}
						>
							Export All ({automationCount})
						</button>
					</div>
				{/if}
			</div>
			
			{#if automationCount === 0}
				<p class="empty-message">No automations to export</p>
			{:else}
				<div class="item-select-bar">
					<label class="select-all-label">
						<input type="checkbox" checked={selectedAutomations.size === automationCount} onchange={toggleAllAutomations}>
						<span>{selectedAutomations.size === automationCount ? 'Deselect All' : 'Select All'}</span>
					</label>
				</div>
				<div class="export-items">
					{#each data.automations as automation}
						{@const id = automation.public_id || automation.id}
						<label class="export-item" class:selected={selectedAutomations.has(id)}>
							<input type="checkbox" checked={selectedAutomations.has(id)} onchange={() => toggleAutomation(id)}>
							<span class="export-item-name">{automation.name}</span>
							<span class="export-item-meta">
								{#if automation.enabled}
									<span class="status-dot active" title="Active"></span>
								{:else}
									<span class="status-dot" title="Disabled"></span>
								{/if}
								{automation.action_type || 'No action'}
							</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
		
		<!-- Commands Export -->
		<div class="export-group">
			<div class="export-group-header">
				<h3>💬 Slash Commands</h3>
				{#if commandCount > 0}
					<div class="export-group-actions">
						<button 
							class="btn btn-sm btn-secondary" 
							disabled={exporting || selectedCommands.size === 0} 
							onclick={() => exportCommands(false)}
						>
							Export Selected ({selectedCommands.size})
						</button>
						<button 
							class="btn btn-sm btn-primary" 
							disabled={exporting} 
							onclick={() => exportCommands(true)}
						>
							Export All ({commandCount})
						</button>
					</div>
				{/if}
			</div>
			
			{#if commandCount === 0}
				<p class="empty-message">No custom commands to export</p>
			{:else}
				<div class="item-select-bar">
					<label class="select-all-label">
						<input type="checkbox" checked={selectedCommands.size === commandCount} onchange={toggleAllCommands}>
						<span>{selectedCommands.size === commandCount ? 'Deselect All' : 'Select All'}</span>
					</label>
				</div>
				<div class="export-items">
					{#each data.commands as command}
						{@const id = String(command.id)}
						<label class="export-item" class:selected={selectedCommands.has(id)}>
							<input type="checkbox" checked={selectedCommands.has(id)} onchange={() => toggleCommand(id)}>
							<span class="export-item-name">/{command.name}</span>
							<span class="export-item-meta">
								{#if command.enabled}
									<span class="status-dot active" title="Active"></span>
								{:else}
									<span class="status-dot" title="Disabled"></span>
								{/if}
								{command.action_type && command.action_type !== 'NONE' ? command.action_type : 'Response only'}
							</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
		
		<!-- Stats Export -->
		<div class="export-group">
			<div class="export-group-header">
				<h3>📊 Stats Data</h3>
				{#if totalStatsRecords > 0}
					<div class="export-group-actions">
						<button 
							class="btn btn-sm btn-primary" 
							disabled={exporting} 
							onclick={exportStats}
						>
							Export All ({totalStatsRecords})
						</button>
					</div>
				{/if}
			</div>
			
			{#if totalStatsRecords === 0}
				<p class="empty-message">No stats data to export</p>
			{:else}
				<div class="stats-summary">
					<div class="stats-summary-item">
						<span class="stats-summary-count">{data.statsCounts.server_stats}</span>
						<span class="stats-summary-label">Server snapshots</span>
					</div>
					<div class="stats-summary-item">
						<span class="stats-summary-count">{data.statsCounts.aggregated_stats}</span>
						<span class="stats-summary-label">Aggregated periods</span>
					</div>
					<div class="stats-summary-item">
						<span class="stats-summary-count">{data.statsCounts.voice_sessions}</span>
						<span class="stats-summary-label">Voice sessions</span>
					</div>
				</div>
			{/if}
		</div>
	</section>
	
	<!-- Import Section -->
	<section class="section-card">
		<div class="section-header">
			<h2><span class="section-icon">📥</span> Import</h2>
			<p class="section-desc">Upload a SpaceBot export file to import automations, commands, or stats data</p>
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
						<p>Importing...</p>
					</div>
				{:else}
					<div class="drop-zone-content">
						<span class="drop-icon">📁</span>
						<p>Drag & drop your export file here</p>
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
					<li>Accepts full backups, or individual automation, command, and stats export files — the format is auto-detected</li>
					<li>Server-specific references (channels, roles, users) are <strong>automatically cleared</strong> during import for automations/commands</li>
					<li>Automations and commands are imported as <strong>disabled</strong> — enable them after reviewing</li>
					<li>Commands with duplicate names will fail — rename existing commands first</li>
					<li>Stats data is imported with duplicate prevention — existing records are preserved</li>
				</ul>
			</div>
		{:else}
			<!-- Import Results -->
			<div class="import-results">
				<div class="result-summary {(importResult.failed > 0 || !importResult.success) ? 'partial' : 'success'}">
					<span class="result-icon">{(importResult.failed > 0 || !importResult.success) ? '⚠️' : '✅'}</span>
					<p>{importResult.message}</p>
				</div>
				
				{#if importResult.type === 'backup' && importResult.results}
					<!-- Unified backup import results -->
					{@const r = importResult.results}
					
					{#if r.automations?.results?.length > 0}
						<div class="backup-result-section">
							<h4>⚡ Automations ({r.automations.imported} imported{r.automations.failed > 0 ? `, ${r.automations.failed} failed` : ''})</h4>
							<div class="result-details">
								{#each r.automations.results as result}
									<div class="result-item {result.success ? 'success' : 'error'}">
										<span class="result-status">{result.success ? '✓' : '✕'}</span>
										<span class="result-name">{result.name}</span>
										{#if result.error}
											<span class="result-error">{result.error}</span>
										{/if}
										{#if result.success && result.needs_configuration}
											<span class="result-needs-config">⚠ needs: {result.needs_configuration}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					
					{#if r.commands?.results?.length > 0}
						<div class="backup-result-section">
							<h4>💬 Commands ({r.commands.imported} imported{r.commands.failed > 0 ? `, ${r.commands.failed} failed` : ''})</h4>
							<div class="result-details">
								{#each r.commands.results as result}
									<div class="result-item {result.success ? 'success' : 'error'}">
										<span class="result-status">{result.success ? '✓' : '✕'}</span>
										<span class="result-name">/{result.name}</span>
										{#if result.error}
											<span class="result-error">{result.error}</span>
										{/if}
										{#if result.success && result.needs_configuration}
											<span class="result-needs-config">⚠ needs: {result.needs_configuration}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					
					{#if r.settings?.imported}
						<div class="backup-result-section">
							<h4>⚙️ Settings</h4>
							<p class="backup-result-note">Server settings restored</p>
						</div>
					{/if}
					
					{#if r.stats}
						<div class="backup-result-section">
							<h4>📊 Stats Data</h4>
							<div class="stats-import-results">
								<div class="stats-import-row">
									<span class="stats-import-label">Server snapshots:</span>
									<span>{r.stats.server_stats?.imported || 0} / {r.stats.server_stats?.total || 0}</span>
								</div>
								<div class="stats-import-row">
									<span class="stats-import-label">Aggregated periods:</span>
									<span>{r.stats.aggregated_stats?.imported || 0} / {r.stats.aggregated_stats?.total || 0}</span>
								</div>
								<div class="stats-import-row">
									<span class="stats-import-label">Voice sessions:</span>
									<span>{r.stats.voice_sessions?.imported || 0} / {r.stats.voice_sessions?.total || 0}</span>
								</div>
							</div>
						</div>
					{/if}
				{:else if importResult.type === 'stats' && importResult.results}
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
				{:else if importResult.results?.length > 0}
					<div class="result-details">
						{#each importResult.results as result}
							<div class="result-item {result.success ? 'success' : 'error'}">
								<span class="result-status">{result.success ? '✓' : '✕'}</span>
								<span class="result-name">{result.name}</span>
								{#if result.error}
									<span class="result-error">{result.error}</span>
								{/if}
								{#if result.success && result.needs_configuration}
									<span class="result-needs-config">⚠ needs: {result.needs_configuration}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
				
				<div class="result-actions">
					{#if importResult.type === 'automations'}
						<a href="/admin/{selectedGuildId}/automations" class="btn btn-secondary">
							Go to Automations
						</a>
					{:else if importResult.type === 'commands'}
						<a href="/admin/{selectedGuildId}/commands" class="btn btn-secondary">
							Go to Commands
						</a>
					{:else if importResult.type === 'stats' || importResult.type === 'backup'}
						<a href="/admin/{selectedGuildId}/stats" class="btn btn-secondary">
							Go to Stats
						</a>
					{/if}
					<button class="btn btn-primary" onclick={resetImport}>Import Another</button>
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.import-export-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	
	.back-link {
		display: inline-block;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}
	
	.back-link:hover {
		color: var(--text-primary, #fff);
	}
	
	.page-header {
		margin-bottom: 2rem;
	}
	
	.page-header h1 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.25rem;
		font-size: 1.75rem;
	}
	
	.header-icon {
		font-size: 1.5rem;
	}
	
	.header-subtitle {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9375rem;
	}
	
	/* Section Card */
	.section-card {
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}
	
	.section-header {
		margin-bottom: 1.25rem;
	}
	
	.section-header h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
	}
	
	.section-icon {
		font-size: 1.125rem;
	}
	
	.section-desc {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.875rem;
	}
	
	/* Export Groups */
	.export-group {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}
	
	.export-group:last-child {
		margin-bottom: 0;
	}
	
	.export-group-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	
	.export-group-header h3 {
		margin: 0;
		font-size: 1rem;
	}
	
	.export-group-actions {
		display: flex;
		gap: 0.5rem;
	}
	
	.empty-message {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: 0;
	}
	
	/* Select All Bar */
	.item-select-bar {
		margin-bottom: 0.5rem;
	}
	
	.select-all-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.25rem 0;
	}
	
	.select-all-label:hover {
		color: var(--text-primary, #fff);
	}
	
	.select-all-label input[type="checkbox"] {
		accent-color: var(--accent-color, #5865F2);
		width: 1rem;
		height: 1rem;
	}
	
	/* Export Items List */
	.export-items {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 300px;
		overflow-y: auto;
	}
	
	.export-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s;
		font-size: 0.875rem;
	}
	
	.export-item:hover {
		background: var(--bg-hover, rgba(255, 255, 255, 0.04));
	}
	
	.export-item.selected {
		background: rgba(88, 101, 242, 0.1);
	}
	
	.export-item input[type="checkbox"] {
		accent-color: var(--accent-color, #5865F2);
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
	
	.export-item-name {
		font-weight: 500;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.export-item-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		flex-shrink: 0;
	}
	
	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}
	
	.status-dot.active {
		background: #57F287;
	}
	
	/* Drop Zone */
	.drop-zone {
		border: 2px dashed var(--border-color, #40444b);
		border-radius: 12px;
		padding: 2.5rem;
		text-align: center;
		transition: all 0.2s;
		margin-bottom: 1rem;
	}
	
	.drop-zone.drag-over {
		border-color: var(--accent-color, #5865F2);
		background: rgba(88, 101, 242, 0.1);
	}
	
	.drop-zone-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	
	.drop-icon {
		font-size: 2.5rem;
	}
	
	.drop-zone-content p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.875rem;
	}
	
	.drop-or {
		font-size: 0.75rem !important;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	
	.file-select-btn {
		cursor: pointer;
		margin-top: 0.25rem;
	}
	
	/* Importing State */
	.importing-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
	}
	
	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--border-color, #40444b);
		border-top-color: var(--accent-color, #5865F2);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	
	.importing-state p {
		margin: 0;
		color: var(--text-muted);
	}
	
	/* Error */
	.import-error {
		background: rgba(237, 66, 69, 0.1);
		border: 1px solid rgba(237, 66, 69, 0.3);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		color: #ed4245;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}
	
	/* Notes */
	.import-notes {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		padding: 1rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	
	.import-notes h4 {
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-secondary, #b9bbbe);
	}
	
	.import-notes ul {
		margin: 0;
		padding-left: 1.25rem;
	}
	
	.import-notes li {
		margin-bottom: 0.375rem;
		line-height: 1.4;
	}
	
	.import-notes li:last-child {
		margin-bottom: 0;
	}
	
	/* Import Results */
	.import-results {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.result-summary {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 8px;
	}
	
	.result-summary.success {
		background: rgba(87, 242, 135, 0.1);
		border: 1px solid rgba(87, 242, 135, 0.3);
	}
	
	.result-summary.partial {
		background: rgba(254, 231, 92, 0.1);
		border: 1px solid rgba(254, 231, 92, 0.3);
	}
	
	.result-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	
	.result-summary p {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.5;
	}
	
	.result-details {
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
	}
	
	.result-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.result-item:last-child {
		border-bottom: none;
	}
	
	.result-item.success .result-status {
		color: #57F287;
	}
	
	.result-item.error .result-status {
		color: #ed4245;
	}
	
	.result-name {
		font-weight: 500;
		flex-shrink: 0;
	}
	
	.result-error {
		color: #ed4245;
		font-size: 0.8rem;
		margin-left: auto;
	}
	
	.result-needs-config {
		color: #fee75c;
		font-size: 0.75rem;
		margin-left: auto;
		white-space: nowrap;
	}
	
	.result-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.5rem;
	}
	
	/* Buttons (supplement global styles) */
	.btn-sm {
		font-size: 0.8125rem;
		padding: 0.375rem 0.75rem;
	}
	
	/* Stats summary */
	.stats-summary {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.stats-summary-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 1.25rem;
		background: var(--bg-hover, rgba(255, 255, 255, 0.04));
		border-radius: 8px;
		flex: 1;
		min-width: 100px;
	}
	
	.stats-summary-count {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary, #fff);
	}
	
	.stats-summary-label {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	/* Stats import results */
	.stats-import-results {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		padding: 1rem;
	}
	
	.stats-import-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.875rem;
		padding: 0.25rem 0;
	}
	
	.stats-import-label {
		color: var(--text-muted);
	}
	
	/* Export All bar */
	.export-all-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--accent-color, #5865F2);
		border-radius: 8px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		gap: 1rem;
	}
	
	.export-all-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	
	.export-all-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	
	.export-all-info strong {
		display: block;
		font-size: 0.9375rem;
		margin-bottom: 0.125rem;
	}
	
	.export-all-desc {
		display: block;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	
	/* Backup import result sections */
	.backup-result-section {
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		padding: 0.75rem 1rem;
	}
	
	.backup-result-section h4 {
		margin: 0 0 0.5rem;
		font-size: 0.875rem;
	}
	
	.backup-result-section .result-details {
		border: none;
		border-radius: 0;
	}
	
	.backup-result-note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-muted);
	}
	
	@media (max-width: 600px) {
		.export-group-header {
			flex-direction: column;
			align-items: flex-start;
		}
		
		.export-group-actions {
			width: 100%;
		}
		
		.export-group-actions .btn {
			flex: 1;
		}
		
		.export-all-bar {
			flex-direction: column;
			text-align: center;
		}
		
		.export-all-info {
			flex-direction: column;
			text-align: center;
		}
		
		.export-all-bar .btn {
			width: 100%;
		}
		
		.result-item {
			flex-wrap: wrap;
		}
		
		.result-needs-config,
		.result-error {
			margin-left: 1.25rem;
			width: 100%;
		}
	}
</style>
