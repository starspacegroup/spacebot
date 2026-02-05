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
	const cronJobs = $derived(data?.cronJobs ?? []);
	const cronJobHistory = $derived(data?.cronJobHistory ?? []);
	
	// State for running cron jobs
	let runningJobs = $state({});
	let jobResults = $state({});
	
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
	
	// Format short date for charts
	function formatShortDate(dateStr) {
		if (!dateStr) return '';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
	
	// Format duration in ms to human readable
	function formatDuration(ms) {
		if (!ms) return '—';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60000).toFixed(1)}m`;
	}
	
	// Run a cron job manually
	async function runCronJob(jobName, dangerous = false) {
		// Show confirmation for dangerous jobs
		if (dangerous) {
			const confirmed = confirm('⚠️ This will delete all aggregated statistics and rebuild them from scratch.\n\nThis may take several minutes for large servers.\n\nAre you sure you want to continue?');
			if (!confirmed) return;
		}
		
		runningJobs[jobName] = true;
		jobResults[jobName] = null;
		
		try {
			const response = await fetch('/api/cron', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jobName }),
			});
			
			const result = await response.json();
			
			if (response.ok) {
				jobResults[jobName] = { success: true, ...result };
			} else {
				jobResults[jobName] = { success: false, error: result.error || 'Unknown error' };
			}
		} catch (error) {
			jobResults[jobName] = { success: false, error: error.message };
		} finally {
			runningJobs[jobName] = false;
		}
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
	
	<!-- Cron Jobs -->
	<section class="cron-section">
		<h2 class="section-title">
			<span class="section-icon">⏰</span>
			Scheduled Jobs
		</h2>
		
		<div class="cron-jobs-grid">
			{#each cronJobs as job}
				<div class="cron-job-card {job.dangerous ? 'cron-job-dangerous' : ''}">
					<div class="cron-job-header">
						<div class="cron-job-info">
							<h3 class="cron-job-name">
								{#if job.dangerous}<span class="dangerous-icon">⚠️</span>{/if}
								{job.displayName}
							</h3>
							<p class="cron-job-description">{job.description}</p>
						</div>
						<button 
							class="btn {job.dangerous ? 'btn-danger' : 'btn-primary'} btn-run"
							onclick={() => runCronJob(job.name, job.dangerous)}
							disabled={runningJobs[job.name]}
						>
							{#if runningJobs[job.name]}
								<span class="spinner-small"></span>
								Running...
							{:else}
								▶ Run Now
							{/if}
						</button>
					</div>
					
					<div class="cron-job-details">
						<div class="cron-detail">
							<span class="cron-label">Schedule</span>
							<span class="cron-value">
								{#if job.cronPattern}<code>{job.cronPattern}</code>{/if}
								<span class="cron-schedule-text">{job.schedule}</span>
							</span>
						</div>
						<div class="cron-detail">
							<span class="cron-label">Last Run</span>
							<span class="cron-value">
								{formatDate(job.lastRun)}
								{#if job.lastStatus}
									<span class="status-badge status-{job.lastStatus}">{job.lastStatus}</span>
								{/if}
							</span>
						</div>
						{#if job.lastDuration}
							<div class="cron-detail">
								<span class="cron-label">Duration</span>
								<span class="cron-value">{formatDuration(job.lastDuration)}</span>
							</div>
						{/if}
					</div>
					
					{#if jobResults[job.name]}
						<div class="cron-result {jobResults[job.name].success ? 'result-success' : 'result-error'}">
							{#if jobResults[job.name].success}
								<span class="result-icon">✓</span>
								<span>Completed in {formatDuration(jobResults[job.name].duration)}</span>
								{#if jobResults[job.name].result}
									<details class="result-details">
										<summary>View details</summary>
										<pre>{JSON.stringify(jobResults[job.name].result, null, 2)}</pre>
									</details>
								{/if}
							{:else}
								<span class="result-icon">✗</span>
								<span>Failed: {jobResults[job.name].error}</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		
		{#if cronJobHistory.length > 0}
			<div class="cron-history">
				<h3 class="subsection-title">Recent Executions</h3>
				<div class="history-table-wrapper">
					<table class="history-table">
						<thead>
							<tr>
								<th>Job</th>
								<th>Triggered</th>
								<th>Status</th>
								<th>Duration</th>
								<th>Time</th>
							</tr>
						</thead>
						<tbody>
							{#each cronJobHistory as entry}
								<tr>
									<td class="job-name-cell">
										{cronJobs.find(j => j.name === entry.job_name)?.displayName || entry.job_name}
									</td>
									<td>
										<span class="trigger-badge trigger-{entry.triggered_by}">
											{entry.triggered_by}
										</span>
									</td>
									<td>
										<span class="status-badge status-{entry.status}">{entry.status}</span>
									</td>
									<td class="duration-cell">{formatDuration(entry.duration_ms)}</td>
									<td class="date-cell">{formatDate(entry.started_at)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
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
		width: 100%;
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
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.superadmin-dashboard {
			padding: 2rem 4rem;
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
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	@media (min-width: 640px) {
		.bot-info-card {
			flex-direction: row;
			align-items: center;
			text-align: left;
			gap: 1.5rem;
			padding: 1.5rem;
		}
	}
	
	.bot-avatar {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.bot-avatar {
			width: 80px;
			height: 80px;
		}
	}
	
	.bot-avatar-placeholder {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.bot-avatar-placeholder {
			width: 80px;
			height: 80px;
			font-size: 2.5rem;
		}
	}
	
	.bot-details h2 {
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.bot-details h2 {
			font-size: 1.5rem;
		}
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
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.section-title {
			font-size: 1.25rem;
		}
	}
	
	.section-icon {
		font-size: 1.1rem;
	}
	
	@media (min-width: 640px) {
		.section-icon {
			font-size: 1.25rem;
		}
	}
	
	.section-subtitle {
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--color-text-muted);
		margin-left: 0.25rem;
	}
	
	.voice-charts-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
	}
	
	@media (max-width: 1200px) {
		.voice-charts-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	@media (max-width: 768px) {
		.voice-charts-grid {
			grid-template-columns: 1fr;
		}
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
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	@media (min-width: 480px) {
		.stat-card {
			flex-direction: row;
			align-items: center;
			gap: 1rem;
			padding: 1.25rem;
		}
	}
	
	.stat-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	
	@media (min-width: 480px) {
		.stat-icon {
			font-size: 2rem;
		}
	}
	
	.stat-content {
		display: flex;
		flex-direction: column;
	}
	
	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.2;
	}
	
	@media (min-width: 480px) {
		.stat-value {
			font-size: 1.5rem;
		}
	}
	
	.stat-label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	
	@media (min-width: 480px) {
		.stat-label {
			font-size: 0.85rem;
		}
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
		-webkit-overflow-scrolling: touch;
	}
	
	.servers-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
		min-width: 500px;
	}
	
	@media (min-width: 768px) {
		.servers-table {
			font-size: 0.9rem;
			min-width: auto;
		}
	}
	
	.servers-table th,
	.servers-table td {
		padding: 0.625rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}
	
	@media (min-width: 768px) {
		.servers-table th,
		.servers-table td {
			padding: 0.875rem 1rem;
		}
	}
	
	.servers-table th {
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-elevated);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	@media (min-width: 768px) {
		.servers-table th {
			font-size: 0.8rem;
		}
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
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 768px) {
		.activity-section {
			margin-bottom: 2rem;
		}
	}
	
	.activity-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.375rem;
	}
	
	@media (min-width: 640px) {
		.activity-list {
			gap: 0.5rem;
			padding: 0.5rem;
		}
	}
	
	.activity-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md);
		transition: background var(--transition-fast);
		gap: 0.5rem;
	}
	
	@media (min-width: 640px) {
		.activity-item {
			padding: 0.75rem 1rem;
		}
	}
	
	.activity-item:hover {
		background: var(--color-surface-hover);
	}
	
	.activity-guild {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	
	@media (min-width: 640px) {
		.activity-guild {
			gap: 0.75rem;
		}
	}
	
	.guild-name {
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	@media (min-width: 640px) {
		.guild-name {
			font-size: 1rem;
		}
	}
	
	.activity-count {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-weight: 500;
		white-space: nowrap;
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.activity-count {
			font-size: 0.9rem;
		}
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 2rem 1.5rem;
		background: var(--color-surface);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	@media (min-width: 640px) {
		.empty-state {
			padding: 3rem 2rem;
		}
	}
	
	.empty-icon {
		font-size: 2.5rem;
		margin-bottom: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.empty-icon {
			font-size: 3rem;
			margin-bottom: 1rem;
		}
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
	
	.btn-primary {
		background: var(--color-primary);
		color: #1C1917;
		border: 1px solid var(--color-primary);
	}
	
	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-danger {
		background: var(--color-error, #ef4444);
		color: white;
		border: 1px solid var(--color-error, #ef4444);
	}
	
	.btn-danger:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	
	.btn-danger:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-run {
		white-space: nowrap;
		width: 100%;
		justify-content: center;
	}
	
	@media (min-width: 640px) {
		.btn-run {
			width: auto;
		}
	}
	
	/* Cron Jobs Section */
	.cron-section {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 768px) {
		.cron-section {
			margin-bottom: 2rem;
		}
	}
	
	.cron-jobs-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.cron-job-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}
	
	.cron-job-card.cron-job-dangerous {
		border-color: var(--color-error, #ef4444);
		background: rgba(239, 68, 68, 0.05);
	}
	
	.dangerous-icon {
		margin-right: 0.25rem;
	}
	
	@media (min-width: 640px) {
		.cron-job-card {
			padding: 1.25rem;
		}
	}
	
	.cron-job-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	
	@media (min-width: 640px) {
		.cron-job-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			gap: 1rem;
		}
	}
	
	.cron-job-info {
		flex: 1;
	}
	
	.cron-job-name {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.cron-job-name {
			font-size: 1.1rem;
		}
	}
	
	.cron-job-description {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	
	@media (min-width: 640px) {
		.cron-job-description {
			font-size: 0.9rem;
		}
	}
	
	.cron-job-details {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}
	
	@media (min-width: 640px) {
		.cron-job-details {
			display: flex;
			flex-wrap: wrap;
			gap: 1rem 2rem;
		}
	}
	
	.cron-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.cron-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.cron-value {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.cron-value {
			gap: 0.5rem;
			font-size: 0.9rem;
		}
	}
	
	.cron-value code {
		background: var(--color-surface-elevated);
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm);
		font-family: monospace;
		font-size: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.cron-value code {
			padding: 0.2rem 0.5rem;
			font-size: 0.85rem;
		}
	}
	
	.cron-schedule-text {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.cron-schedule-text {
			font-size: 0.85rem;
		}
	}
	
	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	
	.status-success {
		background: var(--color-success-bg, rgba(34, 197, 94, 0.15));
		color: var(--color-success, #22c55e);
	}
	
	.status-failed {
		background: var(--color-error-bg, rgba(239, 68, 68, 0.15));
		color: var(--color-error, #ef4444);
	}
	
	.status-running {
		background: var(--color-warning-bg, rgba(245, 158, 11, 0.15));
		color: var(--color-warning, #f59e0b);
	}
	
	.cron-result {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	
	.result-success {
		background: var(--color-success-bg, rgba(34, 197, 94, 0.1));
		border: 1px solid var(--color-success, #22c55e);
		color: var(--color-success, #22c55e);
	}
	
	.result-error {
		background: var(--color-error-bg, rgba(239, 68, 68, 0.1));
		border: 1px solid var(--color-error, #ef4444);
		color: var(--color-error, #ef4444);
	}
	
	.result-icon {
		font-weight: 700;
	}
	
	.result-details {
		width: 100%;
		margin-top: 0.5rem;
	}
	
	.result-details summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: inherit;
		opacity: 0.8;
	}
	
	.result-details pre {
		margin: 0.5rem 0 0;
		padding: 0.75rem;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		overflow-x: auto;
		color: var(--color-text);
	}
	
	.spinner-small {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(0, 0, 0, 0.2);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	
	/* Cron History */
	.cron-history {
		margin-top: 1.5rem;
	}
	
	.subsection-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: var(--color-text);
	}
	
	.history-table-wrapper {
		overflow-x: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.history-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.history-table {
			font-size: 0.85rem;
		}
	}
	
	.history-table th,
	.history-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}
	
	@media (min-width: 640px) {
		.history-table th,
		.history-table td {
			padding: 0.75rem 1rem;
		}
	}
	
	.history-table th {
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-elevated);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	@media (min-width: 640px) {
		.history-table th {
			font-size: 0.75rem;
		}
	}
	
	.history-table tbody tr:last-child td {
		border-bottom: none;
	}
	
	.history-table tbody tr:hover {
		background: var(--color-surface-hover);
	}
	
	.job-name-cell {
		font-weight: 500;
		color: var(--color-text);
	}
	
	.duration-cell {
		font-family: monospace;
		color: var(--color-text-muted);
	}
	
	.trigger-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.7rem;
		font-weight: 500;
	}
	
	.trigger-cron {
		background: var(--color-surface-elevated);
		color: var(--color-text-muted);
	}
	
	.trigger-manual {
		background: var(--color-primary-bg, rgba(251, 191, 36, 0.15));
		color: var(--color-primary);
	}
	
	/* Chart Sections */
	.chart-section {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 768px) {
		.chart-section {
			margin-bottom: 2rem;
		}
	}
	
	.section-subtitle {
		display: block;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
		margin-left: 0;
		margin-top: 0.25rem;
	}
	
	@media (min-width: 640px) {
		.section-subtitle {
			display: inline;
			font-size: 0.8rem;
			margin-left: 0.5rem;
			margin-top: 0;
		}
	}
</style>
