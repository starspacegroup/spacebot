<script>
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { formatChartDate, formatDate as tzFormatDate, parseUTCDate } from '$lib/timezone.js';
	
	let { data, form } = $props();
	
	let showLogs = $state(false);
	let showToast = $state(true);
	let processingId = $state(null);
	let expandedLogId = $state(null);
	
	function toggleLogExpand(logId) {
		expandedLogId = expandedLogId === logId ? null : logId;
	}
	
	// Get parent data for guild info
	const selectedGuildId = $derived(data.selectedGuildId);
	
	// Check for success messages from redirects
	const successMessage = $derived(() => {
		const url = page.url;
		if (url.searchParams.has('created')) return 'Command created successfully!';
		if (url.searchParams.has('updated')) return 'Command updated successfully!';
		if (url.searchParams.has('deleted')) return 'Command deleted successfully!';
		return null;
	});
	
	// Clear URL params after showing toast to prevent re-triggering on refresh
	$effect(() => {
		if (successMessage()) {
			const url = new URL(page.url);
			url.searchParams.delete('created');
			url.searchParams.delete('updated');
			url.searchParams.delete('deleted');
			goto(url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
		}
	});
	
	// Get action type info
	function getActionInfo(actionType) {
		if (!actionType || actionType === 'NONE') {
			return { name: 'Response Only', icon: '💬', description: 'Just send a response' };
		}
		return data.actionTypes[actionType] || { name: actionType, icon: '⚡', description: '' };
	}
	
	// Get response type info
	function getResponseInfo(responseType) {
		return data.responseTypes[responseType] || { label: responseType };
	}
	
	// Format relative time
	function formatRelativeTime(dateString) {
		if (!dateString) return 'Never';
		const date = parseUTCDate(dateString);
		if (!date) return dateString;
		const now = new Date();
		const diffMs = now - date;
		const diffSecs = Math.floor(diffMs / 1000);
		const diffMins = Math.floor(diffSecs / 60);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		
		if (diffSecs < 60) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		
		return formatChartDate(dateString, data.timezone);
	}
</script>

<svelte:head>
	<title>Slash Commands | SpaceBot Admin</title>
</svelte:head>

<div class="commands-page">
	{#if (successMessage() || form?.message || form?.error) && showToast}
		<Toast 
			message={successMessage() || form.message || form.error} 
			success={!!(successMessage() || form?.success)} 
			onDismiss={() => showToast = false} 
		/>
	{/if}
	
	<a href="/admin/{selectedGuildId}" class="back-link">← Back to Dashboard</a>
	
	<header class="page-header">
		<div class="header-content">
			<h1>
				<span class="header-icon">⚡</span>
				Slash Commands
			</h1>
			<p class="header-subtitle">Create custom slash commands with automated actions</p>
		</div>
		<div class="header-actions">
			<button class="btn btn-secondary" onclick={() => showLogs = !showLogs}>
				<span>📋</span>
				{showLogs ? 'Hide Logs' : 'View Logs'}
			</button>
			<a href="/admin/{selectedGuildId}/commands/new" class="btn btn-primary">
				<span>➕</span>
				Create Command
			</a>
		</div>
	</header>
	
	{#if showLogs}
		<section class="logs-section card">
			<h2>Recent Command Usage</h2>
			{#if data.recentLogs.length === 0}
				<p class="empty-state">No command usage logs yet</p>
			{:else}
				<div class="logs-list">
					{#each data.recentLogs as log}
						<div class="log-item {log.success ? 'log-success' : 'log-error'}">
							<button class="log-row" onclick={() => toggleLogExpand(log.id)} title="Click to expand details">
								<div class="log-status">
									{log.success ? '✓' : '✕'}
								</div>
								<div class="log-info">
									<span class="log-name">/{log.command_name || `Command #${log.command_id}`}</span>
									<span class="log-user">by {log.user_name || log.user_id}</span>
								</div>
								<div class="log-time">{formatRelativeTime(log.created_at)}</div>
								<div class="log-expand-icon">{expandedLogId === log.id ? '▼' : '▶'}</div>
							</button>
							{#if log.error_message}
								<div class="log-error-msg">{log.error_message}</div>
							{/if}
							{#if expandedLogId === log.id}
								<div class="log-details">
									{#if log.execution_time_ms}
										<div class="log-detail-row">
											<span class="log-detail-label">Execution Time</span>
											<span class="log-detail-value">{log.execution_time_ms}ms</span>
										</div>
									{/if}
									{#if log.channel_id}
										<div class="log-detail-row">
											<span class="log-detail-label">Channel</span>
											<span class="log-detail-value">{log.channel_id}</span>
										</div>
									{/if}
									{#if log.user_id}
										<div class="log-detail-row">
											<span class="log-detail-label">User ID</span>
											<span class="log-detail-value">{log.user_id}</span>
										</div>
									{/if}
									{#if log.created_at}
										<div class="log-detail-row">
											<span class="log-detail-label">Timestamp</span>
											<span class="log-detail-value">{tzFormatDate(log.created_at, data.timezone)}</span>
										</div>
									{/if}
									{#if log.options_used}
										<div class="log-detail-section">
											<span class="log-detail-label">Options Used</span>
											<pre class="log-detail-json">{JSON.stringify(log.options_used, null, 2)}</pre>
										</div>
									{/if}
									{#if log.action_result}
										<div class="log-detail-section">
											<span class="log-detail-label">Action Result</span>
											<pre class="log-detail-json">{JSON.stringify(log.action_result, null, 2)}</pre>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
	
	<!-- Custom Commands -->
	<section class="commands-list">
		{#if data.commands.length === 0}
			<div class="empty-state-card">
				<div class="empty-icon">⚡</div>
				<h2>No Custom Commands Yet</h2>
				<p>Create your first slash command to extend your bot's functionality.</p>
				<a href="/admin/{selectedGuildId}/commands/new" class="btn btn-primary btn-lg">
					<span>➕</span>
					Create Your First Command
				</a>
			</div>
		{:else}
			<div class="command-grid">
				{#each data.commands as command}
					{@const actionInfo = getActionInfo(command.action_type)}
					{@const responseInfo = getResponseInfo(command.response_type)}
					<div class="command-card {command.enabled ? '' : 'disabled'}">
						<div class="command-header">
							<div class="command-name-row">
								<span class="command-slash">/</span>
								<span class="command-name">{command.name}</span>
							</div>
							<form method="POST" action="?/toggle" use:enhance={() => {
								processingId = command.id;
								return async ({ result }) => {
									processingId = null;
									if (result.type === 'success') {
										await invalidateAll();
									} else if (result.type === 'failure') {
										form = result.data;
									}
								};
							}}>
								<input type="hidden" name="id" value={command.id}>
								<input type="hidden" name="guild_id" value={selectedGuildId}>
								<input type="hidden" name="enabled" value={!command.enabled}>
								<button 
									type="submit" 
									class="toggle-btn {command.enabled ? 'enabled' : ''}"
									title={command.enabled ? 'Disable' : 'Enable'}
									disabled={processingId === command.id}
								>
									<span class="toggle-track">
										<span class="toggle-thumb"></span>
									</span>
								</button>
							</form>
						</div>
						
						<div class="command-body">
							<p class="command-description">{command.description}</p>
							
							{#if command.options && command.options.length > 0}
								<div class="command-options">
									<span class="options-label">Options:</span>
									{#each command.options as option}
										<span class="option-tag" class:required={option.required}>
											{option.name}
											{#if option.required}<span class="required-star">*</span>{/if}
										</span>
									{/each}
								</div>
							{/if}
							
							<div class="command-config">
								<div class="config-item">
									<span class="config-icon">{actionInfo.icon}</span>
									<span class="config-label">{actionInfo.name}</span>
								</div>
								<div class="config-item">
									<span class="config-icon">{command.ephemeral ? '👁️' : '📢'}</span>
									<span class="config-label">{command.ephemeral ? 'Private' : 'Public'}</span>
								</div>
							</div>
						</div>
						
						<div class="command-footer">
							<div class="command-stats">
								<span class="stat" title="Times used">
									🔄 {command.use_count || 0}
								</span>
								<span class="stat" title="Last used">
									🕐 {formatRelativeTime(command.last_used_at)}
								</span>
							</div>
							<div class="command-actions">
								<a href="/admin/{selectedGuildId}/commands/{command.id}" class="btn btn-sm btn-secondary">
									✏️ Edit
								</a>
								<form method="POST" action="?/delete" use:enhance={() => {
									processingId = command.id;
									return async ({ result }) => {
										processingId = null;
										if (result.type === 'success') {
											await invalidateAll();
										} else if (result.type === 'failure') {
											form = result.data;
										}
									};
								}} onsubmit={(e) => { if (!confirm('Delete this command?')) e.preventDefault(); }}>
									<input type="hidden" name="id" value={command.id}>
									<input type="hidden" name="guild_id" value={selectedGuildId}>
									<button type="submit" class="btn btn-sm btn-danger" disabled={processingId === command.id}>
										{processingId === command.id ? '...' : '🗑️ Delete'}
									</button>
								</form>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Built-in Commands -->
	{#if data.builtInCommands?.filter(c => c.enabled).length > 0}
		<section class="builtin-commands">
			<h2 class="section-title">Built-in Commands</h2>
			<p class="builtin-hint">These commands are managed globally and available on all servers.</p>
			<div class="command-grid">
				{#each data.builtInCommands.filter(c => c.enabled) as command}
					{@const actionInfo = getActionInfo(command.action_type)}
					{@const responseInfo = getResponseInfo(command.response_type)}
					<div class="command-card builtin">
						<div class="command-header">
							<div class="command-name-row">
								<span class="command-slash">/</span>
								<span class="command-name">{command.name}</span>
							</div>
							<span class="builtin-badge">Built-in</span>
						</div>
						<div class="command-body">
							<p class="command-description">{command.description}</p>
							
							{#if command.options && command.options.length > 0}
								<div class="command-options">
									<span class="options-label">Options:</span>
									{#each command.options as option}
										<span class="option-tag" class:required={option.required}>
											{option.name}
											{#if option.required}<span class="required-star">*</span>{/if}
										</span>
									{/each}
								</div>
							{/if}
							
							<div class="command-config">
								<div class="config-item">
									<span class="config-icon">{actionInfo.icon}</span>
									<span class="config-label">{actionInfo.name}</span>
								</div>
								<div class="config-item">
									<span class="config-icon">{command.ephemeral ? '👁️' : '📢'}</span>
									<span class="config-label">{command.ephemeral ? 'Private' : 'Public'}</span>
								</div>
							</div>
						</div>
						
						<div class="command-footer">
							<div class="command-stats">
								<span class="stat" title="Times used">
									🔄 {command.use_count || 0}
								</span>
								<span class="stat" title="Last used">
									🕐 {formatRelativeTime(command.last_used_at)}
								</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.commands-page {
		width: 100%;
		margin: 0 auto;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.commands-page {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.commands-page {
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.commands-page {
			padding: 2rem 4rem;
		}
	}
	
	.back-link {
		display: inline-block;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1rem;
		transition: color 0.2s;
	}
	
	.back-link:hover {
		color: var(--text-primary, #fff);
	}
	
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		flex-wrap: wrap;
		gap: 1rem;
	}
	
	.header-content h1 {
		font-size: 2rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	
	.header-icon {
		font-size: 1.5rem;
	}
	
	.header-subtitle {
		color: var(--text-muted);
		margin: 0.25rem 0 0;
	}
	
	.header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	
	/* Cards */
	.card {
		background: var(--bg-secondary, #2f3136);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}
	
	/* Empty State */
	.empty-state-card {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--bg-secondary, #2f3136);
		border-radius: 16px;
		border: 2px dashed var(--border-color, #40444b);
	}
	
	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}
	
	.empty-state-card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
	}
	
	.empty-state-card p {
		color: var(--text-muted);
		margin: 0 0 1.5rem;
	}
	
	/* Command Grid */
	.command-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1.5rem;
	}
	
	.command-card {
		background: var(--bg-secondary, #2f3136);
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--border-color, #40444b);
		transition: transform 0.2s, box-shadow 0.2s;
	}
	
	.command-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.command-card.builtin {
		border-color: var(--accent-color, #5865F2);
		border-style: dashed;
	}

	.builtin-badge {
		font-size: 0.7rem;
		padding: 0.2rem 0.5rem;
		background: var(--accent-color, #5865F2);
		color: #fff;
		border-radius: 4px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.section-title {
		font-size: 1rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 1rem;
	}

	.builtin-commands {
		margin-bottom: 2rem;
	}

	.builtin-hint {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: -0.5rem 0 1rem;
	}
	
	.command-card.disabled {
		opacity: 0.6;
	}
	
	.command-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.command-name-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	
	.command-slash {
		color: var(--accent-color, #5865F2);
		font-weight: 700;
		font-size: 1.25rem;
	}
	
	.command-name {
		font-weight: 600;
		font-size: 1.1rem;
	}
	
	/* Toggle Button */
	.toggle-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	
	.toggle-track {
		display: block;
		width: 44px;
		height: 24px;
		background: var(--bg-primary, #202225);
		border-radius: 12px;
		position: relative;
		transition: background 0.2s;
	}
	
	.toggle-btn.enabled .toggle-track {
		background: var(--accent-color, #5865F2);
	}
	
	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		background: white;
		border-radius: 50%;
		transition: transform 0.2s;
	}
	
	.toggle-btn.enabled .toggle-thumb {
		transform: translateX(20px);
	}
	
	.command-body {
		padding: 1rem;
	}
	
	.command-description {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: 0 0 1rem;
	}
	
	.command-options {
		margin-bottom: 1rem;
		font-size: 0.75rem;
	}
	
	.options-label {
		color: var(--text-muted);
		margin-right: 0.5rem;
	}
	
	.option-tag {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
		margin-right: 0.25rem;
		font-family: monospace;
	}
	
	.option-tag.required {
		border: 1px solid var(--accent-color, #5865F2);
	}
	
	.required-star {
		color: var(--color-danger);
		margin-left: 0.125rem;
	}
	
	.command-config {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.config-item {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 4px;
		font-size: 0.75rem;
	}
	
	.command-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-top: 1px solid var(--border-color, #40444b);
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.command-stats {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.command-actions {
		display: flex;
		gap: 0.5rem;
	}
	
	.command-actions form {
		display: inline;
	}
	
	/* Logs Section */
	.logs-section h2 {
		margin: 0 0 1rem;
		font-size: 1.25rem;
	}
	
	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.log-item {
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		overflow: hidden;
	}
	
	.log-row {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 1rem;
		padding: 0.75rem 1rem;
		align-items: center;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}
	
	.log-row:hover {
		background: color-mix(in srgb, var(--bg-tertiary, #36393f) 80%, white 5%);
	}
	
	.log-status {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: bold;
	}
	
	.log-success .log-status {
		background: var(--color-success);
		color: #1B1730;
	}
	
	.log-error .log-status {
		background: var(--color-danger);
		color: #1B1730;
	}
	
	.log-info {
		display: flex;
		flex-direction: column;
	}
	
	.log-name {
		font-weight: 500;
	}
	
	.log-user {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.log-time {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.log-error-msg {
		font-size: 0.75rem;
		color: var(--color-danger);
		padding: 0.5rem 1rem 0.75rem;
		border-top: 1px solid var(--border-color, #40444b);
	}
	
	.log-expand-icon {
		font-size: 0.625rem;
		color: var(--text-muted);
		transition: transform 0.15s;
	}
	
	.log-details {
		padding: 0.75rem 1rem 1rem;
		border-top: 1px solid var(--border-color, #40444b);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.log-detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
	}
	
	.log-detail-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted);
	}
	
	.log-detail-value {
		font-size: 0.8rem;
		color: var(--text-secondary, #dcddde);
	}
	
	.log-detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	
	.log-detail-json {
		background: var(--bg-primary, #202225);
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.7rem;
		font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		max-height: 300px;
		overflow-y: auto;
		color: var(--text-secondary, #dcddde);
	}
	

	
	.empty-state {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
	
	/* Responsive */
	@media (max-width: 768px) {
		.commands-page {
			padding: 1rem;
		}
		
		.page-header {
			flex-direction: column;
		}
		
		.header-actions {
			width: 100%;
			flex-wrap: wrap;
		}
		
		.header-actions .btn {
			flex: 1;
		}
		
		.command-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
