<script>
	let { data } = $props();
	
	// Track if data has been loaded (not just default empty values)
	// Data is considered loaded when we have an explicit response from the server
	const isLoaded = $derived(data?.isSuperAdmin === true);
	
	// Defensive defaults for data properties
	const guilds = $derived(data?.guilds ?? []);
	const summary = $derived(data?.summary ?? { totalGuilds: 0, totalMembers: 0, totalChannels: 0 });
	const globalStats = $derived(data?.globalStats ?? { 
		totalAutomations: 0, 
		activeAutomations: 0, 
		totalCommands: 0, 
		totalEventLogs: 0, 
		totalWebhooks: 0, 
		recentActivityByGuild: [] 
	});
	const botApp = $derived(data?.botApp ?? null);
	
	// Format large numbers with commas
	function formatNumber(num) {
		return new Intl.NumberFormat().format(num || 0);
	}
	
	// Format date
	function formatDate(dateStr) {
		if (!dateStr) return 'Never';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Superadmin Panel | SpaceBot</title>
</svelte:head>

<div class="superadmin-dashboard">
	<header class="dashboard-header">
		<div class="header-content">
			<div class="header-text">
				<h1>
					<span class="header-icon">👑</span>
					Superadmin Panel
				</h1>
				<p class="header-subtitle">Global bot statistics and management</p>
			</div>
			<a href="/admin" class="btn btn-secondary">
				← Back to Dashboard
			</a>
		</div>
	</header>
	
	{#if !isLoaded}
		<!-- Loading State -->
		<div class="loading-state">
			<div class="loading-spinner"></div>
			<p>Loading superadmin data...</p>
		</div>
	{:else}
	
	{#if botApp}
		<section class="bot-info-section">
			<div class="bot-info-card">
				{#if botApp.icon}
					<img 
						src="https://cdn.discordapp.com/app-icons/{botApp.id}/{botApp.icon}.png" 
						alt="{botApp.name}"
						class="bot-avatar"
					/>
				{:else}
					<div class="bot-avatar-placeholder">🤖</div>
				{/if}
				<div class="bot-details">
					<h2>{botApp.name}</h2>
					<p class="bot-id">ID: {botApp.id}</p>
					{#if botApp.description}
						<p class="bot-description">{botApp.description}</p>
					{/if}
					<div class="bot-badges">
						<span class="badge {botApp.isPublic ? 'badge-success' : 'badge-warning'}">
							{botApp.isPublic ? 'Public Bot' : 'Private Bot'}
						</span>
					</div>
				</div>
			</div>
		</section>
	{/if}
	
	<!-- Summary Stats -->
	<section class="stats-section">
		<h2 class="section-title">
			<span class="section-icon">📊</span>
			Overview
		</h2>
		<div class="stats-grid">
			<div class="stat-card stat-primary">
				<div class="stat-icon">🏠</div>
				<div class="stat-content">
					<span class="stat-value">{formatNumber(summary.totalGuilds)}</span>
					<span class="stat-label">Servers</span>
				</div>
			</div>
			<div class="stat-card stat-blue">
				<div class="stat-icon">👥</div>
				<div class="stat-content">
					<span class="stat-value">{formatNumber(summary.totalMembers)}</span>
					<span class="stat-label">Total Members</span>
				</div>
			</div>
			<div class="stat-card stat-purple">
				<div class="stat-icon">⚡</div>
				<div class="stat-content">
					<span class="stat-value">{formatNumber(globalStats.activeAutomations)}</span>
					<span class="stat-label">Active Automations</span>
				</div>
			</div>
			<div class="stat-card stat-green">
				<div class="stat-icon">💬</div>
				<div class="stat-content">
					<span class="stat-value">{formatNumber(globalStats.totalCommands)}</span>
					<span class="stat-label">Custom Commands</span>
				</div>
			</div>
		</div>
	</section>
	
	<!-- Database Stats -->
	<section class="stats-section">
		<h2 class="section-title">
			<span class="section-icon">🗄️</span>
			Database Statistics
		</h2>
		<div class="stats-grid stats-grid-small">
			<div class="stat-card-mini">
				<span class="stat-label">Total Automations</span>
				<span class="stat-value">{formatNumber(globalStats.totalAutomations)}</span>
			</div>
			<div class="stat-card-mini">
				<span class="stat-label">Event Logs (30d)</span>
				<span class="stat-value">{formatNumber(globalStats.totalEventLogs)}</span>
			</div>
			<div class="stat-card-mini">
				<span class="stat-label">Webhooks</span>
				<span class="stat-value">{formatNumber(globalStats.totalWebhooks)}</span>
			</div>
			<div class="stat-card-mini">
				<span class="stat-label">Total Channels</span>
				<span class="stat-value">{formatNumber(summary.totalChannels)}</span>
			</div>
		</div>
	</section>
	
	<!-- Server List -->
	<section class="servers-section">
		<h2 class="section-title">
			<span class="section-icon">🏠</span>
			All Servers ({guilds.length})
		</h2>
		
		{#if guilds.length > 0}
			<div class="servers-table-wrapper">
				<table class="servers-table">
					<thead>
						<tr>
							<th>Server</th>
							<th class="numeric">Members</th>
							<th class="numeric">Channels</th>
							<th class="numeric">Boost</th>
							<th>Last Updated</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each guilds as guild}
							<tr>
								<td class="server-cell">
									{#if guild.icon}
										<img 
											src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=32" 
											alt=""
											class="server-icon-small"
										/>
									{:else}
										<div class="server-icon-placeholder-small">
											{guild.name?.charAt(0).toUpperCase() || '?'}
										</div>
									{/if}
									<div class="server-details">
										<span class="server-name">{guild.name}</span>
										<span class="server-id">{guild.id}</span>
									</div>
								</td>
								<td class="numeric">
									{formatNumber(guild.stats?.member_count || guild.approximate_member_count || '—')}
								</td>
								<td class="numeric">
									{guild.stats?.channel_count || '—'}
								</td>
								<td class="numeric">
									{#if guild.stats?.boost_level}
										<span class="boost-level">Level {guild.stats.boost_level}</span>
									{:else}
										—
									{/if}
								</td>
								<td class="date-cell">
									{formatDate(guild.stats?.recorded_at)}
								</td>
								<td>
									<a href="/admin/{guild.id}" class="btn btn-sm btn-secondary">
										Manage
									</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="empty-state">
				<div class="empty-icon">🤖</div>
				<p>The bot is not in any servers yet.</p>
			</div>
		{/if}
	</section>
	
	<!-- Recent Activity by Guild -->
	{#if globalStats.recentActivityByGuild?.length > 0}
		<section class="activity-section">
			<h2 class="section-title">
				<span class="section-icon">📈</span>
				Most Active Servers (Last 7 Days)
			</h2>
			<div class="activity-list">
				{#each globalStats.recentActivityByGuild as activity}
					{@const guild = guilds.find(g => g.id === activity.guild_id)}
					<div class="activity-item">
						<div class="activity-guild">
							{#if guild?.icon}
								<img 
									src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=32" 
									alt=""
									class="server-icon-small"
								/>
							{:else}
								<div class="server-icon-placeholder-small">
									{guild?.name?.charAt(0).toUpperCase() || '?'}
								</div>
							{/if}
							<span class="guild-name">{guild?.name || activity.guild_id}</span>
						</div>
						<span class="activity-count">{formatNumber(activity.event_count)} events</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
	
	{/if}
</div>

<style>
	.superadmin-dashboard {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
		min-height: 100vh;
	}
	
	@media (min-width: 640px) {
		.superadmin-dashboard {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.superadmin-dashboard {
			padding: 2rem;
		}
	}
	
	/* Header */
	.dashboard-header {
		margin-bottom: 2rem;
	}
	
	.header-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	@media (min-width: 640px) {
		.header-content {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
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
	
	.header-subtitle {
		margin: 0.5rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	/* Loading State */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
		gap: 1rem;
	}
	
	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	
	/* Bot Info */
	.bot-info-section {
		margin-bottom: 2rem;
	}
	
	.bot-info-card {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 1.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.bot-avatar {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	
	.bot-avatar-placeholder {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.5rem;
		flex-shrink: 0;
	}
	
	.bot-details h2 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}
	
	.bot-id {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}
	
	.bot-description {
		margin: 0 0 0.75rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	.bot-badges {
		display: flex;
		gap: 0.5rem;
	}
	
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.75rem;
		border-radius: var(--radius-full);
		font-size: 0.75rem;
		font-weight: 600;
	}
	
	.badge-success {
		background: var(--color-success-bg, rgba(34, 197, 94, 0.15));
		color: var(--color-success, #22c55e);
	}
	
	.badge-warning {
		background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
		color: var(--color-warning, #f59e0b);
	}
	
	/* Stats Section */
	.stats-section {
		margin-bottom: 2rem;
	}
	
	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: var(--color-text);
	}
	
	.section-icon {
		font-size: 1.25rem;
	}
	
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}
	
	@media (min-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	
	.stats-grid-small {
		grid-template-columns: repeat(2, 1fr);
	}
	
	@media (min-width: 640px) {
		.stats-grid-small {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	
	.stat-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.stat-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}
	
	.stat-content {
		display: flex;
		flex-direction: column;
	}
	
	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.2;
	}
	
	.stat-label {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	
	.stat-primary {
		border-left: 4px solid var(--color-primary);
	}
	
	.stat-blue {
		border-left: 4px solid #3b82f6;
	}
	
	.stat-purple {
		border-left: 4px solid #8b5cf6;
	}
	
	.stat-green {
		border-left: 4px solid #22c55e;
	}
	
	.stat-card-mini {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	
	.stat-card-mini .stat-label {
		order: -1;
		font-size: 0.8rem;
	}
	
	.stat-card-mini .stat-value {
		font-size: 1.25rem;
	}
	
	/* Servers Section */
	.servers-section {
		margin-bottom: 2rem;
	}
	
	.servers-table-wrapper {
		overflow-x: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.servers-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	
	.servers-table th,
	.servers-table td {
		padding: 0.875rem 1rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}
	
	.servers-table th {
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-elevated);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.servers-table tbody tr:last-child td {
		border-bottom: none;
	}
	
	.servers-table tbody tr:hover {
		background: var(--color-surface-hover);
	}
	
	.servers-table .numeric {
		text-align: right;
	}
	
	.server-cell {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.server-icon-small {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	
	.server-icon-placeholder-small {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-primary);
		color: #1C1917;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 600;
		flex-shrink: 0;
	}
	
	.server-details {
		display: flex;
		flex-direction: column;
	}
	
	.server-name {
		font-weight: 500;
		color: var(--color-text);
	}
	
	.server-id {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}
	
	.date-cell {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		white-space: nowrap;
	}
	
	.boost-level {
		color: #f472b6;
		font-weight: 500;
	}
	
	/* Activity Section */
	.activity-section {
		margin-bottom: 2rem;
	}
	
	.activity-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.5rem;
	}
	
	.activity-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		transition: background var(--transition-fast);
	}
	
	.activity-item:hover {
		background: var(--color-surface-hover);
	}
	
	.activity-guild {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.guild-name {
		font-weight: 500;
		color: var(--color-text);
	}
	
	.activity-count {
		font-size: 0.9rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
		background: var(--color-surface);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.empty-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
	}
	
	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
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
	
	.btn-sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
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
</style>
