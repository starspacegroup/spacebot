<script>
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	
	let { data, form } = $props();
	
	let showLogs = $state(false);
	let registering = $state(false);
	
	// Get parent data for guild info
	const selectedGuildId = $derived(data.selectedGuildId);
	
	// Check for success messages from redirects
	const successMessage = $derived(() => {
		const url = page.url;
		if (url.searchParams.has('created')) return 'Command created successfully!';
		if (url.searchParams.has('updated')) return 'Command updated successfully!';
		if (url.searchParams.has('deleted')) return 'Command deleted successfully!';
		if (url.searchParams.has('registered')) return 'Commands registered with Discord!';
		return null;
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
		const date = new Date(dateString);
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
		
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
	
	// Count unregistered commands
	const unregisteredCount = $derived(data.commands.filter(c => !c.registered && c.enabled).length);
</script>

<svelte:head>
	<title>Slash Commands | SpaceBot Admin</title>
</svelte:head>

<div class="commands-page">
	{#if successMessage() || form?.message || form?.error}
		<div class="toast {(successMessage() || form?.success) ? 'toast-success' : 'toast-error'}">
			<span class="toast-icon">{(successMessage() || form?.success) ? '✓' : '✕'}</span>
			<span>{successMessage() || form.message || form.error}</span>
		</div>
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
			<form method="POST" action="?/register" use:enhance={() => {
				registering = true;
				return async ({ result, update }) => {
					registering = false;
					await update();
				};
			}}>
				<input type="hidden" name="guild_id" value={selectedGuildId}>
				<button type="submit" class="btn {unregisteredCount > 0 ? 'btn-warning' : 'btn-secondary'}" disabled={registering}>
					<span>🔄</span>
					{#if registering}
						Syncing...
					{:else if unregisteredCount > 0}
						Sync {unregisteredCount} Command{unregisteredCount > 1 ? 's' : ''}
					{:else}
						Sync Commands
					{/if}
				</button>
			</form>
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
							<div class="log-status">
								{log.success ? '✓' : '✕'}
							</div>
							<div class="log-info">
								<span class="log-name">/{log.command_name || `Command #${log.command_id}`}</span>
								<span class="log-user">by {log.user_name || log.user_id}</span>
							</div>
							<div class="log-time">{formatRelativeTime(log.created_at)}</div>
							{#if log.error_message}
								<div class="log-error-msg">{log.error_message}</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
	
	<!-- Commands List -->
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
								{#if command.registered}
									<span class="registered-badge" title="Synced with Discord">✓</span>
								{:else if command.enabled}
									<span class="pending-badge" title="Needs sync">⚠️</span>
								{/if}
							</div>
							<form method="POST" action="?/toggle" use:enhance>
								<input type="hidden" name="id" value={command.id}>
								<input type="hidden" name="guild_id" value={selectedGuildId}>
								<input type="hidden" name="enabled" value={!command.enabled}>
								<button 
									type="submit" 
									class="toggle-btn {command.enabled ? 'enabled' : ''}"
									title={command.enabled ? 'Disable' : 'Enable'}
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
								<form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm('Delete this command?')) e.preventDefault(); }}>
									<input type="hidden" name="id" value={command.id}>
									<input type="hidden" name="guild_id" value={selectedGuildId}>
									<button type="submit" class="btn btn-sm btn-danger">
										🗑️ Delete
									</button>
								</form>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.commands-page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
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
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border: none;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-primary {
		background: var(--accent-color, #5865F2);
		color: white;
	}
	
	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover, #4752C4);
	}
	
	.btn-secondary {
		background: var(--bg-secondary, #2f3136);
		color: var(--text-primary, #fff);
	}
	
	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-tertiary, #36393f);
	}
	
	.btn-warning {
		background: #FEE75C;
		color: #000;
	}
	
	.btn-warning:hover:not(:disabled) {
		background: #e5cf52;
	}
	
	.btn-danger {
		background: #ED4245;
		color: white;
	}
	
	.btn-danger:hover:not(:disabled) {
		background: #c93b3e;
	}
	
	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}
	
	.btn-lg {
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
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
	
	.registered-badge {
		color: #57F287;
		font-size: 0.875rem;
		margin-left: 0.5rem;
	}
	
	.pending-badge {
		font-size: 0.875rem;
		margin-left: 0.5rem;
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
		color: #ED4245;
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
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 8px;
		align-items: center;
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
		background: #57F287;
		color: #000;
	}
	
	.log-error .log-status {
		background: #ED4245;
		color: #fff;
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
		grid-column: 1 / -1;
		font-size: 0.75rem;
		color: #ED4245;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-color, #40444b);
		margin-top: 0.5rem;
	}
	
	/* Toast */
	.toast {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		padding: 1rem 1.5rem;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		z-index: 1100;
		animation: slideIn 0.3s ease;
	}
	
	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	
	.toast-success {
		background: #57F287;
		color: #000;
	}
	
	.toast-error {
		background: #ED4245;
		color: #fff;
	}
	
	.toast-icon {
		font-weight: bold;
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
