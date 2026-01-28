<script>
	import { enhance } from '$app/forms';
	
	let { data, form } = $props();
	let loading = $state(null);
	let refreshing = $state(false);
	
	// Get category info for a log entry
	function getCategoryInfo(category) {
		return data.eventCategories?.[category] || { name: category, icon: '📌', color: '#888' };
	}
	
	// Get event type description
	function getEventDescription(eventType) {
		return data.eventTypes?.[eventType]?.description || eventType;
	}
	
	// Format timestamp to relative time
	function formatRelativeTime(dateString) {
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
	
	// Format timestamp for full display
	function formatFullTime(dateString) {
		const date = new Date(dateString);
		return date.toLocaleString('en-US', { 
			month: 'short', 
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
	
	// Get selected guild info
	$effect(() => {
		if (data.selectedGuildId && data.adminGuilds) {
			// Guild changed, could trigger refresh here
		}
	});
</script>

<svelte:head>
	<title>Admin Dashboard | SpaceBot</title>
</svelte:head>

<div class="admin-dashboard">
	{#if form?.message}
		<div class="toast {form.success ? 'toast-success' : 'toast-error'}">
			<span class="toast-icon">{form.success ? '✓' : '✕'}</span>
			<span>{form.message}</span>
		</div>
	{/if}
	
	{#if !data.isAdmin}
		<!-- Access Denied State -->
		<div class="access-denied-container">
			<div class="access-denied-card">
				<div class="access-denied-icon">🔒</div>
				<h1>Access Denied</h1>
				<p>You need to be an administrator of a server where the bot is installed to access this dashboard.</p>
				{#if data.user}
					<p class="hint">If you're a server admin, make sure the bot is added to your server first.</p>
					<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-lg">
						<span class="btn-icon">🤖</span>
						Add Bot to a Server
					</a>
				{:else}
					<a href="/login" class="btn btn-primary btn-lg">
						<span class="btn-icon">🔑</span>
						Login with Discord
					</a>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Main Dashboard -->
		<header class="dashboard-header">
			<div class="header-content">
				<h1>
					<span class="header-icon">🚀</span>
					Admin Dashboard
				</h1>
				{#if data.selectedGuildId}
					{@const selectedGuild = data.adminGuilds?.find(g => g.id === data.selectedGuildId)}
					{#if selectedGuild}
						<p class="header-subtitle">Managing <strong>{selectedGuild.name}</strong></p>
					{/if}
				{:else}
					<p class="header-subtitle">Select a server above to get started</p>
				{/if}
			</div>
		</header>
		
		<!-- Event Logs Widget - Hero Section -->
		<section class="logs-hero">
			<div class="logs-hero-header">
				<div class="logs-title-group">
					<h2>
						<span class="section-icon">📊</span>
						Recent Activity
					</h2>
					{#if data.logStats}
						<div class="logs-stat-badge">
							<span class="stat-number">{data.logStats.totalEvents?.toLocaleString() || 0}</span>
							<span class="stat-label">total events</span>
						</div>
					{/if}
				</div>
				
				{#if data.selectedGuildId}
					{@const selectedGuild = data.adminGuilds?.find(g => g.id === data.selectedGuildId)}
					{#if selectedGuild?.botIsInServer !== false}
						<a href="/admin/{data.selectedGuildId}/logs" class="btn btn-view-logs">
							<span>View All Logs</span>
							<span class="btn-arrow">→</span>
						</a>
					{/if}
				{/if}
			</div>
			
			{#if !data.selectedGuildId}
				<!-- No server selected -->
				<div class="logs-empty-state">
					<div class="empty-icon">🎯</div>
					<h3>Select a Server</h3>
					<p>Choose a server from the dropdown above to view activity logs</p>
				</div>
			{:else}
				{@const selectedGuild = data.adminGuilds?.find(g => g.id === data.selectedGuildId)}
				{#if selectedGuild?.botIsInServer === false}
					<!-- Bot not in server -->
					<div class="logs-empty-state logs-warning">
						<div class="empty-icon">⚠️</div>
						<h3>Bot Not Installed</h3>
						<p>Add the bot to <strong>{selectedGuild?.name}</strong> to start logging events</p>
						<a href="/api/auth/discord?flow=install" class="btn btn-primary">
							<span class="btn-icon">🤖</span>
							Add Bot to Server
						</a>
					</div>
				{:else if data.recentLogs && data.recentLogs.length > 0}
					<!-- Event Log Stream -->
					<div class="logs-stream">
						{#each data.recentLogs as log, i}
							{@const category = getCategoryInfo(log.event_category)}
							<div class="log-entry" style="--delay: {i * 50}ms; --category-color: {category.color}">
								<div class="log-icon" style="background: {category.color}20; color: {category.color}">
									{category.icon}
								</div>
								<div class="log-content">
									<div class="log-header">
										<span class="log-type">{getEventDescription(log.event_type)}</span>
										<time class="log-time" title={formatFullTime(log.created_at)}>
											{formatRelativeTime(log.created_at)}
										</time>
									</div>
									<div class="log-details">
										{#if log.actor_name}
											<span class="log-actor">
												<span class="detail-icon">👤</span>
												{log.actor_name}
											</span>
										{/if}
										{#if log.channel_name}
											<span class="log-channel">
												<span class="detail-icon">#</span>
												{log.channel_name}
											</span>
										{/if}
										{#if log.target_name && log.target_name !== log.actor_name}
											<span class="log-target">
												<span class="detail-icon">→</span>
												{log.target_name}
											</span>
										{/if}
									</div>
								</div>
								<div class="log-category-tag" style="background: {category.color}15; color: {category.color}; border-color: {category.color}30">
									{category.name}
								</div>
							</div>
						{/each}
					</div>
					
					<!-- Category Stats Bar -->
					{#if data.logStats?.byCategory}
						<div class="category-stats">
							<h4>Activity by Category</h4>
							<div class="category-bars">
								{#each Object.entries(data.logStats.byCategory) as [cat, count]}
									{@const catInfo = getCategoryInfo(cat)}
									{@const percentage = Math.min(100, (count / (data.logStats.totalEvents || 1)) * 100)}
									<div class="category-bar-item" title="{catInfo.name}: {count} events">
										<div class="bar-label">
											<span class="bar-icon">{catInfo.icon}</span>
											<span class="bar-name">{catInfo.name}</span>
										</div>
										<div class="bar-track">
											<div class="bar-fill" style="width: {percentage}%; background: {catInfo.color}"></div>
										</div>
										<span class="bar-count">{count}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{:else}
					<!-- No logs yet -->
					<div class="logs-empty-state">
						<div class="empty-icon">📭</div>
						<h3>No Activity Yet</h3>
						<p>Events will appear here as they happen in your server</p>
					</div>
				{/if}
			{/if}
		</section>
		
		<!-- Stats Grid -->
		<section class="stats-section">
			<div class="stats-grid">
				<div class="stat-card stat-primary">
					<div class="stat-icon">🖥️</div>
					<div class="stat-info">
						<span class="stat-value">{data.stats?.servers || 0}</span>
						<span class="stat-label">Servers</span>
					</div>
				</div>
				
				<div class="stat-card stat-success">
					<div class="stat-icon">⚡</div>
					<div class="stat-info">
						<span class="stat-value">{data.latency || 0}<span class="stat-unit">ms</span></span>
						<span class="stat-label">Latency</span>
					</div>
				</div>
				
				<div class="stat-card stat-info">
					<div class="stat-icon">⏱️</div>
					<div class="stat-info">
						<span class="stat-value">{data.uptime || '0m'}</span>
						<span class="stat-label">Uptime</span>
					</div>
				</div>
				
				<div class="stat-card stat-accent">
					<div class="stat-icon">🎮</div>
					<div class="stat-info">
						<span class="stat-value">{data.commands?.length || 0}</span>
						<span class="stat-label">Commands</span>
					</div>
				</div>
			</div>
		</section>
		
		<!-- Quick Links Section -->
		{#if data.selectedGuildId}
			{@const selectedGuild = data.adminGuilds?.find(g => g.id === data.selectedGuildId)}
			{#if selectedGuild?.botIsInServer !== false}
				<section class="quick-links-section">
					<h2>
						<span class="section-icon">🔧</span>
						Server Management
					</h2>
					<div class="quick-links-grid">
						<a href="/admin/{data.selectedGuildId}/logs" class="quick-link-card">
							<div class="quick-link-icon">📊</div>
							<div class="quick-link-info">
								<span class="quick-link-title">Event Logs</span>
								<span class="quick-link-desc">View all server activity logs</span>
							</div>
							<span class="quick-link-arrow">→</span>
						</a>
						<a href="/admin/{data.selectedGuildId}/automations" class="quick-link-card">
							<div class="quick-link-icon">⚡</div>
							<div class="quick-link-info">
								<span class="quick-link-title">Automations</span>
								<span class="quick-link-desc">Set up automatic actions on events</span>
							</div>
							<span class="quick-link-arrow">→</span>
						</a>
						<a href="/admin/{data.selectedGuildId}/commands" class="quick-link-card">
							<div class="quick-link-icon">💬</div>
							<div class="quick-link-info">
								<span class="quick-link-title">Slash Commands</span>
								<span class="quick-link-desc">Create custom slash commands</span>
							</div>
							<span class="quick-link-arrow">→</span>
						</a>
					</div>
				</section>
			{/if}
		{/if}
		
		<!-- Bot Commands Section -->
		<section class="commands-section">
			<div class="section-header">
				<h2>
					<span class="section-icon">⚡</span>
					Bot Commands
				</h2>
				{#if data.isSuperAdmin}
					<form method="POST" action="?/refreshCommands" use:enhance={() => {
						loading = 'refresh';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn btn-sm btn-secondary" disabled={loading === 'refresh'}>
							{#if loading === 'refresh'}
								<span class="spinner"></span>
								Refreshing...
							{:else}
								<span class="btn-icon">🔄</span>
								Refresh Commands
							{/if}
						</button>
					</form>
				{/if}
			</div>
			
			<div class="commands-grid">
				{#if data.commands && data.commands.length > 0}
					{#each data.commands as command}
						<div class="command-card">
							<code class="command-name">/{command.name}</code>
							<p class="command-desc">{command.description}</p>
						</div>
					{/each}
				{:else}
					<div class="commands-empty">
						<p>No commands registered yet</p>
					</div>
				{/if}
			</div>
		</section>
		
		<!-- Admin Actions (Superadmin only) -->
		{#if data.isSuperAdmin}
			<section class="admin-actions-section">
				<div class="section-header">
					<h2>
						<span class="section-icon">🛡️</span>
						Admin Controls
					</h2>
					<span class="superadmin-badge">Superadmin</span>
				</div>
				
				<div class="admin-actions-grid">
					<form method="POST" action="?/clearCache" use:enhance={() => {
						loading = 'cache';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="action-card" disabled={loading === 'cache'}>
							<div class="action-icon">🗑️</div>
							<div class="action-info">
								<span class="action-title">Clear Cache</span>
								<span class="action-desc">Reset cached data</span>
							</div>
							{#if loading === 'cache'}
								<span class="spinner spinner-sm"></span>
							{/if}
						</button>
					</form>
					
					<form method="POST" action="?/restartBot" use:enhance={() => {
						loading = 'restart';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="action-card action-warning" disabled={loading === 'restart'}>
							<div class="action-icon">🔁</div>
							<div class="action-info">
								<span class="action-title">Reset State</span>
								<span class="action-desc">Reset bot internal state</span>
							</div>
							{#if loading === 'restart'}
								<span class="spinner spinner-sm"></span>
							{/if}
						</button>
					</form>
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	/* Base Dashboard Styles */
	.admin-dashboard {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
		min-height: 100vh;
	}
	
	@media (min-width: 640px) {
		.admin-dashboard {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.admin-dashboard {
			padding: 2rem;
		}
	}
	
	/* Toast Notifications */
	.toast {
		position: fixed;
		top: 1rem;
		right: 1rem;
		left: 1rem;
		max-width: 400px;
		margin-left: auto;
		padding: 1rem 1.25rem;
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-weight: 500;
		z-index: 100;
		animation: slideIn 0.3s ease;
		box-shadow: var(--shadow-lg);
	}
	
	@keyframes slideIn {
		from { transform: translateY(-20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
	
	.toast-success {
		background: linear-gradient(135deg, #22c55e, #16a34a);
		color: white;
	}
	
	.toast-error {
		background: linear-gradient(135deg, #ef4444, #dc2626);
		color: white;
	}
	
	.toast-icon {
		font-size: 1.25rem;
	}
	
	/* Access Denied */
	.access-denied-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
	}
	
	.access-denied-card {
		text-align: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		max-width: 400px;
		width: 100%;
	}
	
	@media (min-width: 640px) {
		.access-denied-card {
			padding: 3rem;
		}
	}
	
	.access-denied-icon {
		font-size: 4rem;
		margin-bottom: 1.5rem;
	}
	
	.access-denied-card h1 {
		font-size: 1.5rem;
		margin: 0 0 1rem;
		color: var(--color-text);
	}
	
	.access-denied-card p {
		color: var(--color-text-muted);
		margin: 0 0 1rem;
	}
	
	.access-denied-card .hint {
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}
	
	/* Dashboard Header */
	.dashboard-header {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.dashboard-header {
			margin-bottom: 2rem;
		}
	}
	
	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.header-content h1 {
			font-size: 2rem;
		}
	}
	
	.header-icon {
		font-size: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.header-icon {
			font-size: 2rem;
		}
	}
	
	.header-subtitle {
		margin: 0.5rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	.header-subtitle strong {
		color: var(--color-primary);
	}
	
	/* Logs Hero Section */
	.logs-hero {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
		margin-bottom: 1.5rem;
		overflow: hidden;
	}
	
	@media (min-width: 640px) {
		.logs-hero {
			padding: 1.5rem;
			margin-bottom: 2rem;
		}
	}
	
	.logs-hero-header {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	@media (min-width: 640px) {
		.logs-hero-header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 1.5rem;
		}
	}
	
	.logs-title-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	
	.logs-hero h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.logs-hero h2 {
			font-size: 1.5rem;
		}
	}
	
	.section-icon {
		font-size: 1.25rem;
	}
	
	.logs-stat-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-full);
		font-size: 0.8rem;
	}
	
	.stat-number {
		font-weight: 700;
	}
	
	.stat-label {
		color: var(--color-text-muted);
	}
	
	/* View Logs Button */
	.btn-view-logs {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.25rem;
		background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all var(--transition-fast);
		text-decoration: none;
	}
	
	.btn-view-logs:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(88, 101, 242, 0.3);
		color: white;
	}
	
	.btn-arrow {
		transition: transform var(--transition-fast);
	}
	
	.btn-view-logs:hover .btn-arrow {
		transform: translateX(3px);
	}
	
	/* Empty State */
	.logs-empty-state {
		text-align: center;
		padding: 2rem 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}
	
	@media (min-width: 640px) {
		.logs-empty-state {
			padding: 3rem 2rem;
		}
	}
	
	.logs-warning {
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.2);
	}
	
	.empty-icon {
		font-size: 2.5rem;
		margin-bottom: 1rem;
	}
	
	@media (min-width: 640px) {
		.empty-icon {
			font-size: 3rem;
		}
	}
	
	.logs-empty-state h3 {
		font-size: 1.1rem;
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.logs-empty-state h3 {
			font-size: 1.25rem;
		}
	}
	
	.logs-empty-state p {
		margin: 0 0 1rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	/* Log Stream */
	.logs-stream {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	@media (min-width: 640px) {
		.logs-stream {
			gap: 0.75rem;
		}
	}
	
	.log-entry {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		border-left: 3px solid var(--category-color);
		animation: fadeIn 0.3s ease backwards;
		animation-delay: var(--delay);
		transition: background var(--transition-fast);
	}
	
	@media (min-width: 640px) {
		.log-entry {
			padding: 1rem;
			gap: 1rem;
		}
	}
	
	.log-entry:hover {
		background: var(--color-surface-hover);
	}
	
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}
	
	.log-icon {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		font-size: 1rem;
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.log-icon {
			width: 2.5rem;
			height: 2.5rem;
			font-size: 1.25rem;
		}
	}
	
	.log-content {
		min-width: 0;
		flex: 1;
	}
	
	.log-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}
	
	.log-type {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.85rem;
	}
	
	@media (min-width: 640px) {
		.log-type {
			font-size: 0.95rem;
		}
	}
	
	.log-time {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-left: auto;
	}
	
	.log-details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	
	.log-actor,
	.log-channel,
	.log-target {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	
	.detail-icon {
		opacity: 0.7;
	}
	
	.log-category-tag {
		display: none;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 600;
		border: 1px solid;
		white-space: nowrap;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	
	@media (min-width: 768px) {
		.log-category-tag {
			display: block;
		}
	}
	
	/* Category Stats */
	.category-stats {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
	}
	
	.category-stats h4 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin: 0 0 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.category-bars {
		display: grid;
		gap: 0.75rem;
	}
	
	.category-bar-item {
		display: grid;
		grid-template-columns: 100px 1fr auto;
		align-items: center;
		gap: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.category-bar-item {
			grid-template-columns: 120px 1fr auto;
		}
	}
	
	.bar-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	
	.bar-icon {
		font-size: 1rem;
	}
	
	.bar-name {
		color: var(--color-text);
		font-weight: 500;
	}
	
	.bar-track {
		height: 6px;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-full);
		overflow: hidden;
	}
	
	.bar-fill {
		height: 100%;
		border-radius: var(--radius-full);
		transition: width 0.5s ease;
	}
	
	.bar-count {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
		min-width: 40px;
		text-align: right;
	}
	
	/* Stats Section */
	.stats-section {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.stats-section {
			margin-bottom: 2rem;
		}
	}
	
	/* Quick Links Section */
	.quick-links-section {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.quick-links-section {
			margin-bottom: 2rem;
		}
	}
	
	.quick-links-section h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	.quick-links-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.quick-links-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1rem;
		}
	}
	
	.quick-link-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: inherit;
		transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
	}
	
	.quick-link-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
		border-color: var(--color-primary);
	}
	
	.quick-link-icon {
		font-size: 1.5rem;
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(88, 101, 242, 0.15);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}
	
	.quick-link-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.quick-link-title {
		font-weight: 600;
		color: var(--color-text);
	}
	
	.quick-link-desc {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	
	.quick-link-arrow {
		font-size: 1.25rem;
		color: var(--color-text-muted);
		transition: transform var(--transition-fast), color var(--transition-fast);
	}
	
	.quick-link-card:hover .quick-link-arrow {
		transform: translateX(4px);
		color: var(--color-primary);
	}
	
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
			gap: 1rem;
		}
	}
	
	.stat-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: transform var(--transition-fast), box-shadow var(--transition-fast);
	}
	
	@media (min-width: 640px) {
		.stat-card {
			padding: 1.25rem;
			gap: 1rem;
		}
	}
	
	.stat-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}
	
	.stat-card .stat-icon {
		font-size: 1.5rem;
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.stat-card .stat-icon {
			font-size: 1.75rem;
			width: 3rem;
			height: 3rem;
		}
	}
	
	.stat-primary .stat-icon { background: rgba(88, 101, 242, 0.15); }
	.stat-success .stat-icon { background: rgba(87, 242, 135, 0.15); }
	.stat-info .stat-icon { background: rgba(52, 152, 219, 0.15); }
	.stat-accent .stat-icon { background: rgba(155, 89, 182, 0.15); }
	
	.stat-card .stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1;
	}
	
	@media (min-width: 640px) {
		.stat-card .stat-value {
			font-size: 1.5rem;
		}
	}
	
	.stat-unit {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}
	
	.stat-card .stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
	
	@media (min-width: 640px) {
		.stat-card .stat-label {
			font-size: 0.85rem;
		}
	}
	
	/* Commands Section */
	.commands-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.commands-section {
			padding: 1.5rem;
			margin-bottom: 2rem;
		}
	}
	
	.section-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	
	@media (min-width: 640px) {
		.section-header {
			margin-bottom: 1.5rem;
		}
	}
	
	.section-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	.commands-grid {
		display: grid;
		gap: 0.5rem;
	}
	
	@media (min-width: 640px) {
		.commands-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.75rem;
		}
	}
	
	@media (min-width: 1024px) {
		.commands-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	.command-card {
		padding: 0.75rem 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		transition: background var(--transition-fast);
	}
	
	.command-card:hover {
		background: var(--color-surface-hover);
	}
	
	.command-name {
		display: inline-block;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.35rem;
	}
	
	.command-desc {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	
	.commands-empty {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
	
	/* Admin Actions Section */
	.admin-actions-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.admin-actions-section {
			padding: 1.5rem;
		}
	}
	
	.superadmin-badge {
		background: linear-gradient(135deg, #f59e0b, #d97706);
		color: white;
		padding: 0.25rem 0.75rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.admin-actions-grid {
		display: grid;
		gap: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.admin-actions-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1rem;
		}
	}
	
	.action-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--transition-fast);
		width: 100%;
		text-align: left;
	}
	
	.action-card:hover:not(:disabled) {
		background: var(--color-surface-hover);
		transform: translateY(-1px);
		box-shadow: var(--shadow-sm);
	}
	
	.action-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.action-warning:hover:not(:disabled) {
		border-color: var(--color-warning);
	}
	
	.action-icon {
		font-size: 1.5rem;
	}
	
	.action-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	
	.action-title {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.95rem;
	}
	
	.action-desc {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-md);
		border: none;
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all var(--transition-fast);
		text-decoration: none;
	}
	
	.btn-primary {
		background: var(--color-primary);
		color: white;
	}
	
	.btn-primary:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.btn-secondary {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	
	.btn-secondary:hover {
		background: var(--color-surface-hover);
	}
	
	.btn-lg {
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
	}
	
	.btn-sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-icon {
		font-size: 1.1em;
	}
	
	/* Spinner */
	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid transparent;
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	
	.spinner-sm {
		width: 0.875rem;
		height: 0.875rem;
	}
	
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>