<script>
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	
	let { data, form } = $props();
	
	let showLogs = $state(false);
	
	// Get parent data for guild info
	const selectedGuildId = $derived(data.selectedGuildId);
	
	// Check for success messages from redirects
	const successMessage = $derived(() => {
		const url = page.url;
		if (url.searchParams.has('created')) return 'Automation created successfully!';
		if (url.searchParams.has('updated')) return 'Automation updated successfully!';
		if (url.searchParams.has('deleted')) return 'Automation deleted successfully!';
		return null;
	});
	
	// Get event category for an event type
	function getEventCategory(eventType) {
		return data.eventTypes[eventType]?.category || 'other';
	}
	
	// Get category info
	function getCategoryInfo(category) {
		return data.eventCategories[category] || { name: category, icon: '📌', color: '#888' };
	}
	
	// Get action type info
	function getActionInfo(actionType) {
		return data.actionTypes[actionType] || { name: actionType, icon: '⚡', description: '' };
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
</script>

<svelte:head>
	<title>Automations | SpaceBot Admin</title>
</svelte:head>

<div class="automations-page">
	{#if successMessage() || form?.message || form?.error}
		<div class="toast {(successMessage() || form?.success) ? 'toast-success' : 'toast-error'}">
			<span class="toast-icon">{(successMessage() || form?.success) ? '✓' : '✕'}</span>
			<span>{successMessage() || form.message || form.error}</span>
		</div>
	{/if}
	
	<header class="page-header">
		<div class="header-content">
			<h1>
				<span class="header-icon">⚡</span>
				Automations
			</h1>
			<p class="header-subtitle">Create automatic actions triggered by Discord events</p>
		</div>
		<div class="header-actions">
			<button class="btn btn-secondary" onclick={() => showLogs = !showLogs}>
				<span>📋</span>
				{showLogs ? 'Hide Logs' : 'View Logs'}
			</button>
			<a href="/admin/{selectedGuildId}/automations/new" class="btn btn-primary">
				<span>➕</span>
				Create Automation
			</a>
		</div>
	</header>
	
	{#if showLogs}
		<section class="logs-section card">
			<h2>Recent Execution Logs</h2>
			{#if data.recentLogs.length === 0}
				<p class="empty-state">No automation logs yet</p>
			{:else}
				<div class="logs-list">
					{#each data.recentLogs as log}
						<div class="log-item {log.success ? 'log-success' : 'log-error'}">
							<div class="log-status">
								{log.success ? '✓' : '✕'}
							</div>
							<div class="log-info">
								<span class="log-name">{log.automation_name || `Automation #${log.automation_id}`}</span>
								<span class="log-event">{log.trigger_event}</span>
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
	
	<!-- Automations List -->
	<section class="automations-list">
		{#if data.automations.length === 0}
			<div class="empty-state-card">
				<div class="empty-icon">🤖</div>
				<h2>No Automations Yet</h2>
				<p>Create your first automation to get started.</p>
				<a href="/admin/{selectedGuildId}/automations/new" class="btn btn-primary btn-lg">
					<span>➕</span>
					Create Your First Automation
				</a>
			</div>
		{:else}
			<div class="automation-grid">
				{#each data.automations as automation}
					{@const triggers = automation.trigger_events || (automation.trigger_event ? [automation.trigger_event] : [])}
					{@const primaryTrigger = triggers[0] || automation.trigger_event}
					{@const category = getEventCategory(primaryTrigger)}
					{@const categoryInfo = getCategoryInfo(category)}
					{@const actionInfo = getActionInfo(automation.action_type)}
					<div class="automation-card {automation.enabled ? '' : 'disabled'}">
						<div class="automation-header">
							<div class="automation-triggers">
								{#if triggers.length <= 2}
									{#each triggers as trigger}
										{@const triggerCategory = getEventCategory(trigger)}
										{@const triggerCategoryInfo = getCategoryInfo(triggerCategory)}
										<div class="automation-trigger" style="--category-color: {triggerCategoryInfo.color}">
											<span class="trigger-icon">{triggerCategoryInfo.icon}</span>
											<span class="trigger-event">{trigger.replace(/_/g, ' ')}</span>
										</div>
									{/each}
								{:else}
									<div class="automation-trigger" style="--category-color: {categoryInfo.color}">
										<span class="trigger-icon">{categoryInfo.icon}</span>
										<span class="trigger-event">{primaryTrigger.replace(/_/g, ' ')}</span>
									</div>
									<div class="trigger-count">+{triggers.length - 1} more</div>
								{/if}
							</div>
							<form method="POST" action="?/toggle" use:enhance>
								<input type="hidden" name="id" value={automation.id}>
								<input type="hidden" name="guild_id" value={selectedGuildId}>
								<input type="hidden" name="enabled" value={!automation.enabled}>
								<button 
									type="submit" 
									class="toggle-btn {automation.enabled ? 'enabled' : ''}"
									title={automation.enabled ? 'Disable' : 'Enable'}
								>
									<span class="toggle-track">
										<span class="toggle-thumb"></span>
									</span>
								</button>
							</form>
						</div>
						
						<div class="automation-body">
							<h3 class="automation-name">{automation.name}</h3>
							{#if automation.description}
								<p class="automation-description">{automation.description}</p>
							{/if}
							
							<div class="automation-action">
								<span class="action-icon">{actionInfo.icon}</span>
								<span class="action-name">{actionInfo.name}</span>
							</div>
							
							{#if automation.trigger_filters && Object.keys(automation.trigger_filters).length > 0}
								<div class="automation-filters">
									<span class="filter-label">🎯 Filters:</span>
									{#each Object.entries(automation.trigger_filters) as [key, value]}
										<span class="filter-tag">{key}: {value}</span>
									{/each}
								</div>
							{/if}
						</div>
						
						<div class="automation-footer">
							<div class="automation-stats">
								<span class="stat" title="Times triggered">
									🔄 {automation.trigger_count || 0}
								</span>
								<span class="stat" title="Last triggered">
									🕐 {formatRelativeTime(automation.last_triggered_at)}
								</span>
							</div>
							<div class="automation-actions">
								<a href="/admin/{selectedGuildId}/automations/{automation.id}" class="btn btn-sm btn-secondary">
									✏️ Edit
								</a>
								<form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm('Delete this automation?')) e.preventDefault(); }}>
									<input type="hidden" name="id" value={automation.id}>
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
			
			<!-- Pagination -->
			{#if data.pagination.totalPages > 1}
				<div class="pagination">
					{#if data.pagination.hasPrev}
						<a href="?page={data.pagination.page - 1}" class="btn btn-secondary">← Previous</a>
					{/if}
					<span class="pagination-info">
						Page {data.pagination.page} of {data.pagination.totalPages}
					</span>
					{#if data.pagination.hasNext}
						<a href="?page={data.pagination.page + 1}" class="btn btn-secondary">Next →</a>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</div>

<style>
	.automations-page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
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
	
	.btn-primary {
		background: var(--accent-color, #5865F2);
		color: white;
	}
	
	.btn-primary:hover {
		background: var(--accent-hover, #4752C4);
	}
	
	.btn-secondary {
		background: var(--bg-secondary, #2f3136);
		color: var(--text-primary, #fff);
	}
	
	.btn-secondary:hover {
		background: var(--bg-tertiary, #36393f);
	}
	
	.btn-danger {
		background: #ED4245;
		color: white;
	}
	
	.btn-danger:hover {
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
	
	/* Automation Grid */
	.automation-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1.5rem;
	}
	
	.automation-card {
		background: var(--bg-secondary, #2f3136);
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--border-color, #40444b);
		transition: transform 0.2s, box-shadow 0.2s;
	}
	
	.automation-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}
	
	.automation-card.disabled {
		opacity: 0.6;
	}
	
	.automation-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--bg-tertiary, #36393f);
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.automation-triggers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	
	.automation-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.75rem;
		background: color-mix(in srgb, var(--category-color) 20%, transparent);
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--category-color);
	}
	
	.trigger-count {
		font-size: 0.75rem;
		color: var(--text-muted);
		padding: 0.25rem 0.5rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
	}
	
	.trigger-icon {
		font-size: 1rem;
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
	
	.automation-body {
		padding: 1rem;
	}
	
	.automation-name {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
	}
	
	.automation-description {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: 0 0 1rem;
	}
	
	.automation-action {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-radius: 6px;
		font-size: 0.875rem;
	}
	
	.automation-filters {
		margin-top: 1rem;
		font-size: 0.75rem;
	}
	
	.filter-label {
		color: var(--text-muted);
	}
	
	.filter-tag {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
		margin-left: 0.5rem;
		font-family: monospace;
	}
	
	.automation-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-top: 1px solid var(--border-color, #40444b);
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.automation-stats {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.automation-actions {
		display: flex;
		gap: 0.5rem;
	}
	
	.automation-actions form {
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
	
	.log-event {
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
	
	/* Pagination */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 2rem;
	}
	
	.pagination-info {
		color: var(--text-muted);
		font-size: 0.875rem;
	}
	
	.empty-state {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
	
	/* Responsive */
	@media (max-width: 768px) {
		.automations-page {
			padding: 1rem;
		}
		
		.page-header {
			flex-direction: column;
		}
		
		.header-actions {
			width: 100%;
		}
		
		.header-actions .btn {
			flex: 1;
		}
		
		.automation-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
