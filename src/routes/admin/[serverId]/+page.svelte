<script>
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	
	let { data, form } = $props();
	
	let showToast = $state(true);
	
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
		if (!dateString) return '';
		
		// Parse the date - handle both ISO strings and Unix timestamps
		let date;
		if (typeof dateString === 'number') {
			date = new Date(dateString);
		} else {
			// If it's a string without timezone, assume UTC
			date = new Date(dateString.includes('Z') || dateString.includes('+') ? dateString : dateString + 'Z');
		}
		
		if (isNaN(date.getTime())) return '';
		
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffSecs = Math.floor(diffMs / 1000);
		const diffMins = Math.floor(diffSecs / 60);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		
		if (diffSecs < 0) return 'just now'; // Future timestamps (clock skew)
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
</script>

<svelte:head>
	<title>{data.guild?.name || 'Server'} - Admin Dashboard | SpaceBot</title>
</svelte:head>

<div class="admin-dashboard">
	{#if form?.message && showToast}
		<Toast message={form.message} success={form.success} onDismiss={() => showToast = false} />
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
				<div class="guild-header">
					{#if data.guild?.icon}
						<img 
							src="https://cdn.discordapp.com/icons/{data.serverId}/{data.guild.icon}.png" 
							alt="{data.guild?.name} icon"
							class="guild-icon"
						/>
					{:else}
						<div class="guild-icon-placeholder">
							{data.guild?.name?.charAt(0).toUpperCase() || '?'}
						</div>
					{/if}
					<div class="guild-text">
						<h1>{data.guild?.name || 'Unknown Server'}</h1>
						<span class="guild-id">ID: {data.serverId}</span>
					</div>
				</div>
			</div>
		</header>
		
		{#if !data.botInGuild}
			<div class="error-card">
				<h2>⚠️ Bot Not Installed</h2>
				<p>The bot is not installed in this server. Add the bot to enable features.</p>
				<a href="/api/auth/discord?flow=install" class="btn btn-primary">Add Bot to Server</a>
			</div>
		{:else}
			<!-- Quick Links Section -->
			<section class="quick-links-section">
				<h2>
					<span class="section-icon">🔧</span>
					Server Management
				</h2>
				<div class="quick-links-grid">
					<a href="/admin/{data.serverId}/logs" class="quick-link-card">
						<div class="quick-link-icon">📊</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Event Logs</span>
							<span class="quick-link-desc">View all server activity logs</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
					<a href="/admin/{data.serverId}/automations" class="quick-link-card">
						<div class="quick-link-icon">⚡</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Automations</span>
							<span class="quick-link-desc">Set up automatic actions on events</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
					<a href="/admin/{data.serverId}/commands" class="quick-link-card">
						<div class="quick-link-icon">💬</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Slash Commands</span>
							<span class="quick-link-desc">Create custom slash commands</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
				</div>
			</section>
			
			<!-- Recent Activity Widget - Collapsible -->
			<details class="activity-widget" open>
				<summary class="activity-header">
					<h2>
						<span class="section-icon">⚡</span>
						Recent Activity
					</h2>
					<span class="collapse-indicator">▶</span>
				</summary>
				
				<div class="activity-content">
					{#if data.recentLogs && data.recentLogs.length > 0}
						<div class="activity-list">
							{#each data.recentLogs as log, i}
								{@const category = getCategoryInfo(log.event_category)}
								<div class="activity-item" style="--delay: {i * 30}ms">
									<span class="activity-icon" style="color: {category.color}">{category.icon}</span>
									<span class="activity-text">
										<strong>{getEventDescription(log.event_type)}</strong>
										{#if log.actor_name}
											<span class="activity-actor">by {log.actor_name}</span>
										{/if}
									</span>
									<time class="activity-time" title={formatFullTime(log.created_at)}>
										{formatRelativeTime(log.created_at)}
									</time>
								</div>
							{/each}
						</div>
						<a href="/admin/{data.serverId}/logs" class="activity-view-all">
							View all activity →
						</a>
					{:else}
						<div class="activity-empty">
							<span class="empty-icon">📭</span>
							<span>No activity yet</span>
						</div>
					{/if}
				</div>
			</details>
			
			<!-- Server Settings Panel - Only visible to full administrators -->
			{#if data.hasFullAdminAccess}
				<section class="server-settings-section">
					<h2>
						<span class="section-icon">⚙️</span>
						Server Settings
						<span class="admin-badge">Admin Only</span>
					</h2>
					<div class="settings-card">
						<div class="settings-grid">
							<div class="setting-item">
								<div class="setting-info">
									<span class="setting-label">Bot Prefix</span>
									<span class="setting-desc">Command prefix for text commands</span>
								</div>
								<span class="setting-value">!</span>
							</div>
							<div class="setting-item">
								<div class="setting-info">
									<span class="setting-label">Logging Channel</span>
									<span class="setting-desc">Where bot logs are sent</span>
								</div>
								<span class="setting-value">Not configured</span>
							</div>
							<div class="setting-item">
								<div class="setting-info">
									<span class="setting-label">Moderation Role</span>
									<span class="setting-desc">Role with moderation permissions</span>
								</div>
								<span class="setting-value">Not configured</span>
							</div>
							<div class="setting-item">
								<div class="setting-info">
									<span class="setting-label">Welcome Messages</span>
									<span class="setting-desc">Greet new members automatically</span>
								</div>
								<span class="setting-value setting-disabled">Disabled</span>
							</div>
						</div>
						<div class="settings-actions">
							<a href="/admin/{data.serverId}/settings" class="btn btn-secondary">
								<span class="btn-icon">⚙️</span>
								Configure Settings
							</a>
						</div>
					</div>
				</section>
			{/if}
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
	
	/* Back Link */
	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1rem;
		transition: color 0.2s;
	}
	
	.back-link:hover {
		color: var(--color-text);
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
	
	/* Error Card */
	.error-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		text-align: center;
		margin-bottom: 1.5rem;
	}
	
	.error-card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
	}
	
	.error-card p {
		color: var(--color-text-muted);
		margin: 0 0 1rem;
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
	
	.guild-header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	
	.guild-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.guild-icon-placeholder {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 600;
	}
	
	.guild-text h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.guild-text h1 {
			font-size: 2rem;
		}
	}
	
	.guild-id {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	/* Collapsible Activity Widget */
	.activity-widget {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		margin-bottom: 1.25rem;
	}
	
	@media (min-width: 640px) {
		.activity-widget {
			margin-bottom: 1.5rem;
		}
	}
	
	.activity-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem;
		cursor: pointer;
		user-select: none;
		list-style: none;
	}
	
	.activity-header::-webkit-details-marker {
		display: none;
	}
	
	@media (min-width: 640px) {
		.activity-header {
			padding: 1rem 1.25rem;
		}
	}
	
	.activity-header:hover {
		background: var(--color-surface-hover);
		border-radius: var(--radius-lg);
	}
	
	.activity-widget[open] .activity-header {
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
	}
	
	.activity-header h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.activity-header h2 {
			font-size: 1.1rem;
		}
	}
	
	.collapse-indicator {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		transition: transform var(--transition-fast);
	}
	
	.activity-widget[open] .collapse-indicator {
		transform: rotate(90deg);
	}
	
	.activity-content {
		padding: 0 0.875rem 0.875rem;
	}
	
	@media (min-width: 640px) {
		.activity-content {
			padding: 0 1.25rem 1.25rem;
		}
	}
	
	.section-icon {
		font-size: 1rem;
	}
	
	/* View All Link */
	.activity-view-all {
		display: block;
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-primary);
		text-decoration: none;
		font-weight: 500;
		padding: 0.5rem;
		margin-top: 0.5rem;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}
	
	.activity-view-all:hover {
		background: var(--color-primary-soft);
	}
	
	/* Compact Activity List */
	.activity-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.activity-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		animation: fadeIn 0.2s ease backwards;
		animation-delay: var(--delay);
		font-size: 0.85rem;
	}
	
	@media (min-width: 640px) {
		.activity-item {
			padding: 0.625rem 0.75rem;
			font-size: 0.9rem;
		}
	}
	
	.activity-icon {
		font-size: 0.95rem;
		flex-shrink: 0;
	}
	
	.activity-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text);
	}
	
	.activity-text strong {
		font-weight: 500;
	}
	
	.activity-actor {
		color: var(--color-text-muted);
		font-size: 0.8em;
	}
	
	.activity-time {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}
	
	/* Empty States */
	.activity-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1.25rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	.activity-empty .empty-icon {
		font-size: 1.25rem;
		margin: 0;
	}
	
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
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
		color: #1C1917;
		font-weight: 600;
	}
	
	.btn-primary:hover {
		background: var(--color-primary-hover);
	}
	
	.btn-secondary {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	
	.btn-secondary:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-primary);
	}
	
	.btn-lg {
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-icon {
		font-size: 1.1em;
	}
	
	/* Server Settings Section - Admin Only */
	.server-settings-section {
		margin-top: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.server-settings-section {
			margin-top: 2rem;
		}
	}
	
	.server-settings-section h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	.admin-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.5rem;
		background: rgba(237, 66, 69, 0.15);
		color: #ed4245;
		border-radius: var(--radius-sm);
		margin-left: auto;
	}
	
	.settings-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.settings-card {
			padding: 1.25rem;
		}
	}
	
	.settings-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	
	.setting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}
	
	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	
	.setting-label {
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.9rem;
	}
	
	.setting-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	.setting-value {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		background: var(--color-surface);
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	
	.setting-value.setting-disabled {
		color: var(--color-text-muted);
		opacity: 0.7;
	}
	
	.settings-actions {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
	}
</style>
