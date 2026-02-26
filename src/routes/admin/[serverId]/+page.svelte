<script>
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	import { AreaChart, BarChart, ChartCard } from '$lib/components/charts';
	import { formatChartDate } from '$lib/timezone.js';

	let { data, form } = $props();

	let showToast = $state(true);

	// Transform activity data for the area chart (events per day)
	const activityData = $derived(
		(data.activityChartData || []).map(d => ({
			date: d.period,
			value: d.count,
			label: formatChartDate(d.period, data.timezone)
		}))
	);

	// Transform member growth data for the bar chart (joins vs leaves)
	const memberGrowthData = $derived(
		(data.memberGrowthChartData || []).map(d => ({
			date: d.date,
			label: formatChartDate(d.date, data.timezone),
			values: [
				{ label: 'Joined', value: d.joins || 0, color: '#22c55e' },
				{ label: 'Left', value: d.leaves || 0, color: '#ef4444' }
			]
		}))
	);

	// Transform voice activity data for the area chart (unique users per day)
	const voiceData = $derived(
		(data.voiceActivityChartData || []).map(d => ({
			date: d.date,
			value: d.uniqueUsers || 0,
			label: formatChartDate(d.date, data.timezone)
		}))
	);

	// Summary stats derived from chart data
	const activityTotal = $derived(activityData.reduce((sum, d) => sum + d.value, 0));
	const memberJoins = $derived(memberGrowthData.reduce((sum, d) => sum + (d.values[0]?.value || 0), 0));
	const memberLeaves = $derived(memberGrowthData.reduce((sum, d) => sum + (d.values[1]?.value || 0), 0));
	const peakVoiceUsers = $derived(Math.max(...voiceData.map(d => d.value), 0));
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
			<div class="warning-banner">
				<span class="warning-icon">⚠️</span>
				<div class="warning-content">
					<strong>Bot Not Installed</strong>
					<p>The bot is not installed in this server. Some features require the bot to be added.</p>
				</div>
				<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-sm">Add Bot to Server</a>
			</div>
		{/if}

			<!-- Quick Links Section -->
			<section class="quick-links-section">
				<h2>
					<span class="section-icon">🔧</span>
					Server Management
				</h2>
				<div class="quick-links-grid">
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
					<a href="/admin/{data.serverId}/scheduled-server-events" class="quick-link-card">
						<div class="quick-link-icon">📅</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Scheduled Events</span>
							<span class="quick-link-desc">Manage server events and activities</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
					<a href="/admin/{data.serverId}/integrations" class="quick-link-card">
						<div class="quick-link-icon">🔌</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Integrations</span>
							<span class="quick-link-desc">Connect external apps and services</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
				</div>
			</section>

		{#if data.botInGuild}
			<!-- Statistics Overview -->
			<section class="stats-section">
				<div class="stats-header">
					<h2>
						<span class="section-icon">📈</span>
						Statistics
					</h2>
					<a href="/admin/{data.serverId}/stats" class="btn btn-secondary btn-sm">
						View All Stats →
					</a>
				</div>

				<!-- Key numbers -->
				{#if data.basicStats}
					<div class="stats-highlights">
						<div class="highlight-card">
							<span class="highlight-value">{data.basicStats.members.toLocaleString()}</span>
							<span class="highlight-label">Members</span>
						</div>
						<div class="highlight-card">
							<span class="highlight-value">{data.basicStats.eventsToday.toLocaleString()}</span>
							<span class="highlight-label">Events Today</span>
						</div>
						<div class="highlight-card">
							<span class="highlight-value">{data.basicStats.totalEvents.toLocaleString()}</span>
							<span class="highlight-label">Total Events</span>
						</div>
					</div>
				{/if}

				<!-- Charts grid -->
				<div class="charts-grid">
					<div class="chart-wide">
						<ChartCard
							title="Server Activity"
							subtitle="Last 30 days"
							icon="📊"
							stats={[
								{ value: activityTotal.toLocaleString(), label: 'Total Events' },
							]}
						>
							<AreaChart
								data={activityData}
								color="#5865F2"
								gradientId="dashActivity"
								title="Server Activity"
								emptyMessage="No activity data yet"
								showPoints={false}
							/>
						</ChartCard>
					</div>

					<ChartCard
						title="Member Growth"
						subtitle="Last 30 days"
						icon="👥"
						stats={[
							{ value: `+${memberJoins}`, label: 'Joined', color: '#22c55e' },
							{ value: `-${memberLeaves}`, label: 'Left', color: '#ef4444' },
							{ value: (memberJoins - memberLeaves >= 0 ? '+' : '') + (memberJoins - memberLeaves), label: 'Net', color: memberJoins - memberLeaves >= 0 ? '#22c55e' : '#ef4444' },
						]}
					>
						<BarChart
							data={memberGrowthData}
							title="Member Growth"
							emptyMessage="No member growth data yet"
						/>
					</ChartCard>

					<ChartCard
						title="Voice Activity"
						subtitle="Last 30 days"
						icon="🎙️"
						stats={[
							{ value: peakVoiceUsers, label: 'Peak Unique Voice Users' },
						]}
					>
						<AreaChart
							data={voiceData}
							color="#22c55e"
							gradientId="dashVoice"
							title="Unique Users in Voice"
							emptyMessage="No voice activity data yet"
							showPoints={false}
						/>
					</ChartCard>
				</div>
			</section>

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
									<span class="setting-label">Logging Channel</span>
									<span class="setting-desc">Where bot logs are sent</span>
								</div>
								{#if data.settings?.loggingChannelId}
									<a href="discord://discord.com/channels/{data.serverId}/{data.settings.loggingChannelId}" target="_blank" rel="noopener noreferrer" class="setting-value setting-link">
										#{data.settings.loggingChannelName || data.settings.loggingChannelId}
									</a>
								{:else}
									<span class="setting-value">Not configured</span>
								{/if}
							</div>
							<div class="setting-item">
								<div class="setting-info">
									<span class="setting-label">Welcome Messages</span>
									<span class="setting-desc">Greet new members automatically</span>
								</div>
								<span class="setting-value" class:setting-disabled={!data.settings?.welcomeEnabled}>{data.settings?.welcomeEnabled ? 'Enabled' : 'Disabled'}</span>
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
		width: 100%;
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
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.admin-dashboard {
			padding: 2rem 4rem;
		}
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
	
	/* Warning Banner */
	.warning-banner {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(237, 166, 0, 0.1);
		border: 1px solid rgba(237, 166, 0, 0.3);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		margin-bottom: 1.5rem;
	}

	.warning-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.warning-content {
		flex: 1;
	}

	.warning-content strong {
		display: block;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.warning-content p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
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
	
	.section-icon {
		font-size: 1rem;
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
	

	
	/* Statistics Section */
	.stats-section {
		margin-top: 1.5rem;
	}

	@media (min-width: 640px) {
		.stats-section {
			margin-top: 2rem;
		}
	}

	.stats-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.stats-header h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.btn-sm {
		font-size: 0.8rem;
		padding: 0.4rem 0.75rem;
	}

	.stats-highlights {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.highlight-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.875rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.highlight-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}

	@media (max-width: 639px) {
		.highlight-value {
			font-size: 1.2rem;
		}
	}

	.highlight-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.charts-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 1024px) {
		.charts-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.chart-wide {
		grid-column: 1 / -1;
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
	
	.setting-value.setting-link {
		color: var(--color-primary);
		text-decoration: none;
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	
	.setting-value.setting-link:hover {
		background: var(--color-primary-soft);
		color: var(--color-primary-hover);
	}
	
	.settings-actions {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
	}
</style>
