<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { getDiscordEventTypeMeta } from '$lib/discord/event-metadata.js';
	import { getAvatarUrl } from '$lib/utils/avatar.js';
	import { formatChartDate, formatDate as tzFormatDate, parseUTCDate } from '$lib/timezone.js';
	
	let { data, form } = $props();
	
	let showLogs = $state(false);
	let showToast = $state(true);
	let processingId = $state(null);
	let expandedLogId = $state(null);
	const MAX_VISIBLE_TRIGGERS = 3;
	
	function toggleLogExpand(logId) {
		expandedLogId = expandedLogId === logId ? null : logId;
	}
	
	// Format JSON data for display, filtering out noisy internal fields
	function formatLogData(data) {
		if (!data) return null;
		// Clone to avoid mutating original
		const cleaned = { ...data };
		return cleaned;
	}
	
	// Format trigger data for a cleaner display
	function formatTriggerSummary(triggerData) {
		if (!triggerData) return [];
		const items = [];
		if (triggerData.actor_name) items.push({ label: 'Actor', value: triggerData.actor_name, id: triggerData.actor_id });
		if (triggerData.channel_name) items.push({ label: 'Channel', value: `#${triggerData.channel_name}`, id: triggerData.channel_id });
		if (triggerData.target_name) items.push({ label: 'Target', value: triggerData.target_name, id: triggerData.target_id });
		if (triggerData.event_type) {
			const eventMeta = getDiscordEventTypeMeta(triggerData.event_type);
			items.push({ label: 'Event', value: `${eventMeta.icon} ${eventMeta.description}` });
		}
		return items;
	}
	
	// Get human-readable action name
	function getActionDisplayName(actionType) {
		const info = data.actionTypes[actionType];
		return info ? `${info.icon} ${info.name}` : actionType;
	}
	
	// Summarize action config for display
	function formatActionConfig(config) {
		if (!config || Object.keys(config).length === 0) return null;
		const displayPairs = [];
		for (const [key, value] of Object.entries(config)) {
			if (value === null || value === undefined || value === '') continue;
			// Clean up the key name
			const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
			// Truncate long values
			displayPairs.push({ label, value: displayValue.length > 80 ? displayValue.slice(0, 77) + '...' : displayValue });
		}
		return displayPairs.length > 0 ? displayPairs : null;
	}
	
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

	// Collapse triggers: if all events in a category are selected, show "CATEGORY: *" instead
	function collapseTriggers(triggers) {
		// Group triggers by category
		const byCategory: Record<string, any[]> = {};
		for (const trigger of triggers) {
			const cat = getEventCategory(trigger);
			if (!byCategory[cat]) byCategory[cat] = [];
			byCategory[cat].push(trigger);
		}

		// Count total events per category from the full event type list
		const totalPerCategory = {};
		for (const [eventType, info] of Object.entries(data.eventTypes)) {
			const cat = info.category || 'other';
			totalPerCategory[cat] = (totalPerCategory[cat] || 0) + 1;
		}

		const result = [];
		const handledCategories = new Set();

		for (const [cat, catTriggers] of Object.entries(byCategory)) {
			if (totalPerCategory[cat] && catTriggers.length >= totalPerCategory[cat]) {
				// All events in this category are selected — collapse
				const catInfo = getCategoryInfo(cat);
				result.push({ label: `${cat.toUpperCase()}: *`, category: cat, collapsed: true });
				handledCategories.add(cat);
			}
		}

		// Add individual triggers for non-collapsed categories
		for (const trigger of triggers) {
			const cat = getEventCategory(trigger);
			if (!handledCategories.has(cat)) {
				const eventMeta = getDiscordEventTypeMeta(trigger, { fallbackCategory: cat });
				result.push({ label: eventMeta.description, icon: eventMeta.icon, category: cat, collapsed: false });
			}
		}

		return result;
	}
	
	// Format relative time
	function formatRelativeTime(dateString) {
		if (!dateString) return 'Never';
		const date = parseUTCDate(dateString);
		if (!date) return dateString;
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
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
	<title>Automations | SpaceBot Admin</title>
</svelte:head>

<div class="automations-page">
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
							<button class="log-row" onclick={() => toggleLogExpand(log.id)} title="Click to expand details">
								<div class="log-status">
									{log.success ? '✓' : '✕'}
								</div>
								<div class="log-info">
									<span class="log-name">{log.automation_name || `Automation #${log.automation_id}`}</span>
									<span class="log-event">{log.trigger_event}</span>
								</div>
								<div class="log-time">{formatRelativeTime(log.created_at)}</div>
								<div class="log-expand-icon">{expandedLogId === log.id ? '▼' : '▶'}</div>
							</button>
							{#if log.error_message}
								<div class="log-error-msg">{log.error_message}</div>
							{/if}
							{#if expandedLogId === log.id}
								<div class="log-details">
									<div class="log-meta-row">
										{#if log.execution_time_ms}
											<span class="log-meta-item">⏱️ {log.execution_time_ms}ms</span>
										{/if}
										{#if log.created_at}
											<span class="log-meta-item">📅 {tzFormatDate(log.created_at, data.timezone)}</span>
										{/if}
									</div>
									
									{#if log.trigger_data}
										{@const summary = formatTriggerSummary(log.trigger_data)}
										{#if summary.length > 0}
											<div class="log-trigger-summary">
												<span class="log-detail-label">Trigger</span>
												<div class="trigger-summary-items">
													{#each summary as item}
														<span class="trigger-summary-item">
															<span class="trigger-summary-key">{item.label}:</span>
															<span class="trigger-summary-val">
																{#if item.label === 'Actor' && item.id}
																	<img
																		src={getAvatarUrl(item.id, log.trigger_data?.actor_avatar, log.trigger_data?.actor_discriminator, 18)}
																		alt="{item.value}'s avatar"
																		class="trigger-actor-avatar"
																		onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
																	/>
																{/if}
																{item.value}
															</span>
														</span>
													{/each}
												</div>
											</div>
										{/if}
									{/if}
									
									<!-- Actions breakdown -->
									{#if log.action_result && Array.isArray(log.action_result)}
										<div class="log-actions-section">
											<span class="log-detail-label">Actions ({log.action_result.length})</span>
											<div class="log-actions-list">
												{#each log.action_result as action, i}
													<div class="log-action-item {action.success ? 'action-success' : 'action-error'}">
														<div class="log-action-header">
															<span class="action-status-dot">{action.success ? '✓' : '✕'}</span>
															<span class="action-type-label">{getActionDisplayName(action.actionType)}</span>
															<span class="action-index">#{i + 1}</span>
														</div>
														{#if action.actionConfig}
															{@const configPairs = formatActionConfig(action.actionConfig)}
															{#if configPairs}
																<div class="action-config">
																	{#each configPairs as pair}
																		<div class="action-config-pair">
																			<span class="config-key">{pair.label}</span>
																			<span class="config-val">{pair.value}</span>
																		</div>
																	{/each}
																</div>
															{/if}
														{/if}
														{#if action.error}
															<div class="action-error-msg">❌ {action.error}</div>
														{/if}
														{#if action.result}
															<div class="action-result-data">
																<pre class="action-result-json">{JSON.stringify(action.result, null, 2)}</pre>
															</div>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{:else if log.action_result}
										<!-- Fallback for legacy non-array action_result -->
										<div class="log-detail-section">
											<span class="log-detail-label">Action Result</span>
											<pre class="log-detail-json">{JSON.stringify(log.action_result, null, 2)}</pre>
										</div>
									{/if}
									
									{#if log.trigger_data}
										<details class="log-raw-details">
											<summary class="log-raw-summary">Raw Trigger Data</summary>
											<pre class="log-detail-json">{JSON.stringify(formatLogData(log.trigger_data), null, 2)}</pre>
										</details>
									{/if}
								</div>
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
					{@const displayTriggers = collapseTriggers(triggers)}
					{@const visibleTriggers = displayTriggers.slice(0, MAX_VISIBLE_TRIGGERS)}
					{@const hasMoreTriggers = displayTriggers.length > MAX_VISIBLE_TRIGGERS}
					{@const actionInfo = getActionInfo(automation.action_type)}
					<div class="automation-card {automation.enabled ? '' : 'disabled'}">
						<div class="automation-header">
							<div class="automation-triggers">
								{#each visibleTriggers as trigger}
									{@const triggerCategoryInfo = getCategoryInfo(trigger.category)}
									<div class="automation-trigger" style="--category-color: {triggerCategoryInfo.color}">
										<span class="trigger-icon">{trigger.icon || triggerCategoryInfo.icon}</span>
										<span class="trigger-event">{trigger.label}</span>
									</div>
								{/each}
								{#if hasMoreTriggers}
									<div class="automation-trigger-more">and more</div>
								{/if}
							</div>
							<form method="POST" action="?/toggle" use:enhance={() => {
								processingId = automation.id;
								return async ({ result, update }) => {
									processingId = null;
									if (result.type === 'success') {
										await invalidateAll();
									} else if (result.type === 'failure') {
										form = result.data as any;
									}
								};
							}}>
								<input type="hidden" name="id" value={automation.public_id || automation.id}>
								<input type="hidden" name="guild_id" value={selectedGuildId}>
								<input type="hidden" name="enabled" value={!automation.enabled}>
								<button 
									type="submit" 
									class="toggle-btn {automation.enabled ? 'enabled' : ''}"
									title={automation.enabled ? 'Disable' : 'Enable'}
									disabled={processingId === automation.id}
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
								<a href="/admin/{selectedGuildId}/automations/{automation.public_id || automation.id}" class="btn btn-sm btn-secondary">
									✏️ Edit
								</a>
								<form method="POST" action="?/delete" use:enhance={() => {
									processingId = automation.id;
									return async ({ result }) => {
										processingId = null;
										if (result.type === 'success') {
											await invalidateAll();
										} else if (result.type === 'failure') {
											form = result.data as any;
										}
									};
								}} onsubmit={(e) => { if (!confirm('Delete this automation?')) e.preventDefault(); }}>
									<input type="hidden" name="id" value={automation.public_id || automation.id}>
									<input type="hidden" name="guild_id" value={selectedGuildId}>
									<button type="submit" class="btn btn-sm btn-danger" disabled={processingId === automation.id}>
										{processingId === automation.id ? '...' : '🗑️ Delete'}
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
		width: 100%;
		margin: 0 auto;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.automations-page {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.automations-page {
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.automations-page {
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
		flex-direction: column;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}
	
	@media (min-width: 640px) {
		.page-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			margin-bottom: 2rem;
		}
	}
	
	.header-content h1 {
		font-size: 1.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	
	@media (min-width: 640px) {
		.header-content h1 {
			font-size: 2rem;
		}
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
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	
	.header-actions .btn {
		white-space: normal;
		text-align: center;
		justify-content: center;
	}
	
	@media (min-width: 480px) {
		.header-actions {
			flex-direction: row;
		}
		
		.header-actions .btn {
			flex: 1;
		}
	}
	
	@media (min-width: 640px) {
		.header-actions {
			width: auto;
		}
		
		.header-actions .btn {
			flex: initial;
			white-space: nowrap;
		}
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
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	
	@media (min-width: 640px) {
		.automation-grid {
			gap: 1.5rem;
		}
	}
	
	@media (min-width: 768px) {
		.automation-grid {
			grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		}
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
		padding: 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border-bottom: 1px solid var(--border-color, #40444b);
		gap: 0.5rem;
	}
	
	@media (min-width: 640px) {
		.automation-header {
			padding: 1rem;
		}
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
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		background: color-mix(in srgb, var(--category-color) 20%, transparent);
		border: 1px solid color-mix(in srgb, var(--category-color) 30%, transparent);
		border-radius: 6px;
		font-size: 0.675rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		/* Mix with --color-text so light categories stay readable in light mode
		   and dark categories stay readable in dark mode */
		color: color-mix(in srgb, var(--category-color) 40%, var(--color-text));
		overflow: hidden;
	}
	
	@media (min-width: 640px) {
		.automation-trigger {
			font-size: 0.75rem;
			gap: 0.5rem;
			padding: 0.25rem 0.75rem;
		}
	}

	.automation-trigger-more {
		font-size: 0.675rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted, #9ca3af);
	}

	@media (min-width: 640px) {
		.automation-trigger-more {
			font-size: 0.75rem;
		}
	}
	
	.trigger-event {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		flex-direction: column;
		padding: 0.75rem;
		border-top: 1px solid var(--border-color, #40444b);
		gap: 0.75rem;
	}
	
	@media (min-width: 480px) {
		.automation-footer {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
			padding: 1rem;
			gap: 0.5rem;
		}
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
		width: 100%;
	}
	
	.automation-actions .btn {
		flex: 1;
	}
	
	.automation-actions form {
		display: inline;
		flex: 1;
	}
	
	.automation-actions form .btn {
		width: 100%;
	}
	
	@media (min-width: 480px) {
		.automation-actions {
			width: auto;
		}
		
		.automation-actions .btn {
			flex: initial;
		}
		
		.automation-actions form {
			flex: initial;
		}
		
		.automation-actions form .btn {
			width: auto;
		}
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
		grid-template-columns: auto 1fr auto;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
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
	
	@media (min-width: 640px) {
		.log-row {
			grid-template-columns: auto 1fr auto auto;
			gap: 1rem;
			padding: 0.75rem 1rem;
		}
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
	
	.log-event {
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
		display: none;
	}
	
	@media (min-width: 640px) {
		.log-expand-icon {
			display: block;
		}
	}
	
	.log-details {
		padding: 0.75rem 1rem 1rem;
		border-top: 1px solid var(--border-color, #40444b);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.log-detail-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted);
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
	
	/* Log meta row */
	.log-meta-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	
	.log-meta-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	
	/* Trigger summary */
	.log-trigger-summary {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	
	.trigger-summary-items {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	
	.trigger-summary-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem;
		background: var(--bg-primary, #202225);
		border-radius: 4px;
		font-size: 0.75rem;
	}
	
	.trigger-summary-key {
		color: var(--text-muted);
		font-weight: 600;
	}
	
	.trigger-summary-val {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--text-secondary, #dcddde);
	}

	.trigger-actor-avatar {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	
	/* Actions breakdown */
	.log-actions-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.log-actions-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.log-action-item {
		background: var(--bg-primary, #202225);
		border-radius: 8px;
		padding: 0.625rem 0.75rem;
		border-left: 3px solid var(--text-muted);
	}
	
	.log-action-item.action-success {
		border-left-color: var(--color-success, #43b581);
	}
	
	.log-action-item.action-error {
		border-left-color: var(--color-danger, #f04747);
	}
	
	.log-action-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		font-weight: 600;
	}
	
	.action-status-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		font-weight: bold;
		flex-shrink: 0;
	}
	
	.action-success .action-status-dot {
		background: var(--color-success, #43b581);
		color: white;
	}
	
	.action-error .action-status-dot {
		background: var(--color-danger, #f04747);
		color: white;
	}
	
	.action-type-label {
		flex: 1;
	}
	
	.action-index {
		font-size: 0.65rem;
		color: var(--text-muted);
		font-weight: 400;
	}
	
	.action-config {
		margin-top: 0.375rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding-left: calc(18px + 0.5rem);
	}
	
	.action-config-pair {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.7rem;
	}
	
	.config-key {
		color: var(--text-muted);
	}
	
	.config-val {
		color: var(--text-secondary, #dcddde);
		font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
		font-size: 0.65rem;
	}
	
	.action-error-msg {
		margin-top: 0.375rem;
		padding-left: calc(18px + 0.5rem);
		font-size: 0.75rem;
		color: var(--color-danger, #f04747);
	}
	
	.action-result-data {
		margin-top: 0.375rem;
		padding-left: calc(18px + 0.5rem);
	}
	
	.action-result-json {
		background: color-mix(in srgb, var(--bg-primary, #202225) 80%, var(--color-success, #43b581) 8%);
		border-radius: 4px;
		padding: 0.375rem 0.5rem;
		font-size: 0.65rem;
		font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		max-height: 150px;
		overflow-y: auto;
		color: var(--text-secondary, #dcddde);
	}
	
	/* Raw trigger data collapsible */
	.log-raw-details {
		margin-top: 0.25rem;
	}
	
	.log-raw-summary {
		font-size: 0.7rem;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
		padding: 0.25rem 0;
	}
	
	.log-raw-summary:hover {
		color: var(--text-secondary, #dcddde);
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
	
	/* Log details responsive */
	.log-details {
		padding: 0.625rem 0.75rem 0.75rem;
	}
	
	@media (min-width: 640px) {
		.log-details {
			padding: 0.75rem 1rem 1rem;
		}
	}
	
	.action-config {
		padding-left: 0;
	}
	
	@media (min-width: 640px) {
		.action-config {
			padding-left: calc(18px + 0.5rem);
		}
	}
	
	.action-result-data {
		padding-left: 0;
	}
	
	@media (min-width: 640px) {
		.action-result-data {
			padding-left: calc(18px + 0.5rem);
		}
	}
	
	.action-error-msg {
		padding-left: 0;
	}
	
	@media (min-width: 640px) {
		.action-error-msg {
			padding-left: calc(18px + 0.5rem);
		}
	}
</style>
