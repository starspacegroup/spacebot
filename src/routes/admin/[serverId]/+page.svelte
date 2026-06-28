<script lang="ts">
	import { toast } from '$lib/toast.svelte.js';
	import { AreaChart, BarChart, ChartCard } from '$lib/components/charts';
	import { formatChartDate } from '$lib/timezone.js';

	const { data, form } = $props();

	// The page load returns a fast "shell" (loadMeta.needsHotload) when the
	// in-memory dashboard cache is cold, instead of blocking navigation on
	// Discord API calls, stats aggregation, and a dozen D1 queries. We used to
	// backfill that with goto(url, { invalidateAll: true }), but that forces
	// every loader in the route tree (including the root layout's Discord
	// guild-list fetch) through SvelteKit's client-side data-merge machinery
	// just to refresh one page's stats — fetch the dedicated endpoint instead.
	let liveStats = $state(null);
	let statsServerId = $state(null);
	let statsLoading = $state(false);

	$effect(() => {
		const serverId = data.serverId;
		if (!data.loadMeta?.needsHotload || statsServerId === serverId) return;

		statsLoading = true;
		fetch(`/api/admin/${serverId}/dashboard-stats`)
			.then((res) => {
				if (!res.ok) throw new Error(`dashboard-stats request failed: ${res.status}`);
				return res.json();
			})
			.then((json) => {
				liveStats = json;
				statsServerId = serverId;
			})
			.catch((err) => {
				console.error('[Dashboard] Failed to load live stats:', err);
				// Stop retrying automatically; fall back to the shell defaults below.
				statsServerId = serverId;
			})
			.finally(() => {
				statsLoading = false;
			});
	});

	// Merges the client-fetched stats (once loaded for the current server) over
	// the shell/cached defaults from the page load.
	const dashboard = $derived(
		liveStats && statsServerId === data.serverId
			? liveStats
			: {
					basicStats: data.basicStats,
					memberGrowthChartData: data.memberGrowthChartData,
					voiceActivityChartData: data.voiceActivityChartData,
					featureCounts: data.featureCounts,
					planLimits: data.planLimits,
					localRunnerAssist: data.localRunnerAssist,
					aiAutopilotSummary: data.aiAutopilotSummary,
					settings: data.settings,
				}
	);

	const isDashboardLoading = $derived(statsLoading);

	// Fire a toast once per new form-action result (reference comparison, so a
	// plain non-$state holder is intentional — $state would loop the effect).
	let lastFormResult;
	$effect(() => {
		if (form && form !== lastFormResult && form.message) {
			lastFormResult = form;
			toast[form.success ? 'success' : 'error'](form.message);
		}
	});

	// Transform member growth data for the bar chart (joins vs leaves)
	const memberGrowthData = $derived(
		(dashboard.memberGrowthChartData || []).map((d) => ({
			date: d.date,
			label: formatChartDate(d.date, data.timezone),
			values: [
				{ label: 'Joined', value: d.joins || 0, color: '#22c55e' },
				{ label: 'Left', value: d.leaves || 0, color: '#ef4444' },
			],
		}))
	);

	// Transform voice activity data for the area chart (unique users per day)
	const voiceData = $derived(
		(dashboard.voiceActivityChartData || []).map((d) => ({
			date: d.date,
			value: d.uniqueUsers || 0,
			label: formatChartDate(d.date, data.timezone),
		}))
	);

	// Summary stats derived from chart data
	const memberJoins = $derived(
		memberGrowthData.reduce((sum, d) => sum + (d.values[0]?.value || 0), 0)
	);
	const memberLeaves = $derived(
		memberGrowthData.reduce((sum, d) => sum + (d.values[1]?.value || 0), 0)
	);
	const peakVoiceUsers = $derived(Math.max(...voiceData.map((d) => d.value), 0));
	const aiAutopilotSummary = $derived(
		dashboard.aiAutopilotSummary || {
			total: 0,
			pending: 0,
			running: 0,
			completed: 0,
			failed_terminal: 0,
			canceled: 0,
			latest: null,
		}
	);

	function formatAutopilotStatus(status) {
		switch (status) {
			case 'pending':
				return { label: 'Queued', cls: 'badge-neutral' };
			case 'running':
				return { label: 'Running', cls: 'badge-info' };
			case 'completed':
				return { label: 'Completed', cls: 'badge-success' };
			case 'failed_terminal':
				return { label: 'Failed', cls: 'badge-danger' };
			case 'canceled':
				return { label: 'Canceled', cls: 'badge-warning' };
			default:
				return { label: status || 'Unknown', cls: 'badge-neutral' };
		}
	}

	function truncateText(value, max = 140) {
		if (!value || typeof value !== 'string') return '';
		if (value.length <= max) return value;
		return `${value.slice(0, max - 1)}...`;
	}
</script>

<svelte:head>
	<title>{data.guild?.name || 'Server'} - Admin Dashboard | SpaceBot</title>
</svelte:head>

<div class="admin-dashboard">
	{#if !data.isAdmin}
		<!-- Access Denied State -->
		<div class="access-denied-container">
			<div class="access-denied-card">
				<div class="access-denied-icon">🔒</div>
				<h1>Access Denied</h1>
				<p>
					You need to be an administrator of a server where the bot is installed to access
					this dashboard.
				</p>
				{#if data.user}
					<p class="hint">
						If you're a server admin, make sure the bot is added to your server first.
					</p>
					<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-lg">
						<span class="btn-icon"
							><img src="/logo.webp" alt="" class="inline-logo" /></span
						>
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
							src="https://cdn.discordapp.com/icons/{data.serverId}/{data.guild
								.icon}.png"
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
					<p>
						The bot is not installed in this server. Some features require the bot to be
						added.
					</p>
				</div>
				<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-sm"
					>Add Bot to Server</a
				>
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
						{#if dashboard.featureCounts?.automations}
							{@const fc = dashboard.featureCounts.automations}
							{@const limit = dashboard.planLimits?.max_automations}
							<span
								class="quick-link-usage"
								class:at-limit={limit !== null && fc.active >= limit}
							>
								<span class="usage-count"
									>{fc.active}{limit !== null ? `/${limit}` : ''}</span
								>
								active{#if fc.inactive > 0}<span class="usage-inactive">
										· {fc.inactive} disabled</span
									>{/if}
							</span>
						{/if}
					</div>
					<span class="quick-link-arrow">→</span>
				</a>
				<a href="/admin/{data.serverId}/commands" class="quick-link-card">
					<div class="quick-link-icon">💬</div>
					<div class="quick-link-info">
						<span class="quick-link-title">Slash Commands</span>
						<span class="quick-link-desc">Create custom slash commands</span>
						{#if dashboard.featureCounts?.commands}
							{@const fc = dashboard.featureCounts.commands}
							{@const limit = dashboard.planLimits?.max_commands}
							<span
								class="quick-link-usage"
								class:at-limit={limit !== null && fc.active >= limit}
							>
								<span class="usage-count"
									>{fc.active}{limit !== null ? `/${limit}` : ''}</span
								>
								active{#if fc.inactive > 0}<span class="usage-inactive">
										· {fc.inactive} disabled</span
									>{/if}
							</span>
						{/if}
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
						{#if dashboard.featureCounts?.integrations}
							{@const fc = dashboard.featureCounts.integrations}
							<span class="quick-link-usage">
								<span class="usage-count">{fc.active}</span>
								active{#if fc.inactive > 0}<span class="usage-inactive">
										· {fc.inactive} available</span
									>{/if}
							</span>
						{/if}
					</div>
					<span class="quick-link-arrow">→</span>
				</a>
				<a href="/admin/{data.serverId}/stats" class="quick-link-card">
					<div class="quick-link-icon">📈</div>
					<div class="quick-link-info">
						<span class="quick-link-title">Server Stats</span>
						<span class="quick-link-desc">See growth, events, and voice trends</span>
					</div>
					<span class="quick-link-arrow">→</span>
				</a>
				<a href="/admin/{data.serverId}/logs" class="quick-link-card">
					<div class="quick-link-icon">🧾</div>
					<div class="quick-link-info">
						<span class="quick-link-title">Event Logs</span>
						<span class="quick-link-desc">Review moderation and automation events</span>
					</div>
					<span class="quick-link-arrow">→</span>
				</a>
				<a href="/admin/{data.serverId}/import-export" class="quick-link-card">
					<div class="quick-link-icon">📦</div>
					<div class="quick-link-info">
						<span class="quick-link-title">Import & Export</span>
						<span class="quick-link-desc"
							>Share or back up automations and commands</span
						>
					</div>
					<span class="quick-link-arrow">→</span>
				</a>
				<a
					href="/admin/{data.serverId}/chat"
					class="quick-link-card quick-link-card-coming-soon"
					class:quick-link-card-disabled={!data.isSuperAdmin}
					aria-disabled={!data.isSuperAdmin}
					onclick={(event) => {
						if (!data.isSuperAdmin) event.preventDefault();
					}}
				>
					<div class="quick-link-icon">
						<img src="/logo.webp" alt="" class="inline-logo" />
					</div>
					<div class="quick-link-info">
						<span class="quick-link-title">AI Assistant</span>
						<span class="quick-link-desc">Chat with SpaceBot about this server</span>
						{#if !data.isSuperAdmin}
							<span class="quick-link-usage">Superadmin preview only</span>
						{/if}
					</div>
					<span class="quick-link-arrow">→</span>
					<span class="coming-soon-badge">COMING SOON</span>
				</a>
				{#if data.hasFullAdminAccess}
					<a href="/admin/{data.serverId}/account" class="quick-link-card">
						<div class="quick-link-icon">⚙️</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Account & Billing</span>
							<span class="quick-link-desc">Manage plan, usage, and subscription</span
							>
							{#if dashboard.planLimits?.plan}
								<span class="quick-link-usage">
									<span class="usage-plan-badge plan-{dashboard.planLimits.plan}"
										>{dashboard.planLimits.plan}</span
									> plan
								</span>
							{/if}
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
					<a href="/admin/{data.serverId}/settings" class="quick-link-card">
						<div class="quick-link-icon">🛠️</div>
						<div class="quick-link-info">
							<span class="quick-link-title">Server Settings</span>
							<span class="quick-link-desc">Configure permissions and behavior</span>
						</div>
						<span class="quick-link-arrow">→</span>
					</a>
				{/if}
			</div>
		</section>

		{#if data.botInGuild && dashboard.localRunnerAssist?.enabled}
			<section class="ai-autopilot-section">
				<div class="ai-autopilot-header">
					<h2>
						<span class="section-icon">🤖</span>
						AI Autopilot
					</h2>
					<a href="/account/ai-jobs" class="btn btn-secondary btn-sm"
						>Open All AI Jobs →</a
					>
				</div>

				<div class="ai-autopilot-grid">
					<div class="ai-stat-card">
						<span class="ai-stat-value">{aiAutopilotSummary.total}</span>
						<span class="ai-stat-label">Total</span>
					</div>
					<div class="ai-stat-card">
						<span class="ai-stat-value"
							>{aiAutopilotSummary.pending + aiAutopilotSummary.running}</span
						>
						<span class="ai-stat-label">Active</span>
					</div>
					<div class="ai-stat-card success">
						<span class="ai-stat-value">{aiAutopilotSummary.completed}</span>
						<span class="ai-stat-label">Completed</span>
					</div>
					<div class="ai-stat-card danger">
						<span class="ai-stat-value">{aiAutopilotSummary.failed_terminal}</span>
						<span class="ai-stat-label">Failed</span>
					</div>
				</div>

				{#if aiAutopilotSummary.latest}
					{@const latestStatus = formatAutopilotStatus(aiAutopilotSummary.latest.status)}
					<div class="ai-latest-job">
						<div class="ai-latest-main">
							<div class="ai-latest-top">
								<strong>Latest Job</strong>
								<span class="status-badge {latestStatus.cls}"
									>{latestStatus.label}</span
								>
							</div>
							<div class="ai-latest-meta mono">
								{aiAutopilotSummary.latest.correlationId}
							</div>
							<div class="ai-latest-meta">
								{truncateText(aiAutopilotSummary.latest.requestText, 180)}
							</div>
							<div class="ai-latest-meta">
								Attempts {aiAutopilotSummary.latest
									.attemptCount}/{aiAutopilotSummary.latest.maxAttempts} · Updated {new Date(
									aiAutopilotSummary.latest.updatedAt
								).toLocaleString()}
							</div>
						</div>
						<div class="ai-latest-actions">
							<a
								class="btn btn-outline btn-sm"
								href={`/api/ai/jobs/${aiAutopilotSummary.latest.id}`}
								target="_blank"
								rel="noreferrer">Timeline JSON</a
							>
						</div>
					</div>
				{:else}
					<p class="ai-empty">No AI jobs recorded for this server yet.</p>
				{/if}
			</section>
		{/if}

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

				<!-- Charts grid -->
				<div class="charts-grid">
					<ChartCard
						title="Member Growth"
						subtitle="Last 30 days"
						icon="👥"
						loading={isDashboardLoading}
						stats={[
							{
								value: dashboard.basicStats?.members?.toLocaleString() ?? '—',
								label: 'Members',
							},
							{ value: `+${memberJoins}`, label: 'Joined', color: '#22c55e' },
							{ value: `-${memberLeaves}`, label: 'Left', color: '#ef4444' },
							{
								value:
									(memberJoins - memberLeaves >= 0 ? '+' : '') +
									(memberJoins - memberLeaves),
								label: 'Net',
								color: memberJoins - memberLeaves >= 0 ? '#22c55e' : '#ef4444',
							},
						]}
					>
						<BarChart
							data={memberGrowthData}
							title="Member Growth"
							loading={isDashboardLoading}
							emptyMessage="No member growth data yet"
						/>
					</ChartCard>

					<ChartCard
						title="Voice Activity"
						subtitle="Last 30 days"
						icon="🎙️"
						loading={isDashboardLoading}
						stats={[{ value: peakVoiceUsers, label: 'Peak Unique Voice Users' }]}
					>
						<AreaChart
							data={voiceData}
							color="#22c55e"
							gradientId="dashVoice"
							title="Unique Users in Voice"
							loading={isDashboardLoading}
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
								{#if dashboard.settings?.loggingChannelId}
									<a
										href="discord://discord.com/channels/{data.serverId}/{dashboard
											.settings.loggingChannelId}"
										target="_blank"
										rel="noopener noreferrer"
										class="setting-value setting-link"
									>
										#{dashboard.settings.loggingChannelName ||
											dashboard.settings.loggingChannelId}
									</a>
								{:else}
									<span class="setting-value">Not configured</span>
								{/if}
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

	.data-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 0 1rem;
		padding: 0.65rem 0.9rem;
		border-radius: 10px;
		border: 1px solid var(--color-fixed-border-strong);
		background: var(--color-overlay-scrim-soft);
		color: var(--color-fixed-text-secondary);
		font-size: 0.9rem;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #60a5fa;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
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
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
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
		gap: 0.5rem;
	}

	@media (min-width: 640px) {
		.quick-links-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.5rem;
		}
	}

	@media (min-width: 960px) {
		.quick-links-grid {
			grid-template-columns: repeat(4, 1fr);
			gap: 0.5rem;
		}
	}

	.quick-link-card {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		position: relative;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: inherit;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast),
			border-color var(--transition-fast);
	}

	.quick-link-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
		border-color: var(--color-primary);
	}

	.quick-link-card-coming-soon {
		overflow: hidden;
	}

	.quick-link-card-disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.quick-link-card-disabled:hover {
		transform: none;
		box-shadow: none;
		border-color: var(--color-border);
	}

	.quick-link-icon {
		font-size: 1.15rem;
		width: 2.25rem;
		height: 2.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(88, 101, 242, 0.15);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.quick-link-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.quick-link-title {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.quick-link-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.quick-link-usage {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.15rem;
	}

	.quick-link-usage .usage-count {
		font-weight: 600;
		color: var(--color-primary);
	}

	.quick-link-usage.at-limit .usage-count {
		color: var(--color-warning, #f59e0b);
	}

	.quick-link-usage .usage-inactive {
		opacity: 0.7;
	}

	.usage-plan-badge {
		font-weight: 600;
		text-transform: capitalize;
	}

	.usage-plan-badge.plan-free {
		color: var(--color-text-muted);
	}

	.usage-plan-badge.plan-pro {
		color: var(--color-primary);
	}

	.usage-plan-badge.plan-enterprise {
		color: #f59e0b;
	}

	.quick-link-arrow {
		font-size: 1rem;
		color: var(--color-text-muted);
		transition:
			transform var(--transition-fast),
			color var(--transition-fast);
	}

	.quick-link-card:hover .quick-link-arrow {
		transform: translateX(4px);
		color: var(--color-primary);
	}

	.quick-link-card-disabled:hover .quick-link-arrow {
		transform: none;
		color: var(--color-text-muted);
	}

	.coming-soon-badge {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.4rem;
		border-radius: 999px;
		background: rgba(245, 158, 11, 0.18);
		border: 1px solid rgba(245, 158, 11, 0.5);
		color: #f59e0b;
		pointer-events: none;
	}

	/* Statistics Section */
	.ai-autopilot-section {
		margin-top: 1.5rem;
	}

	@media (min-width: 640px) {
		.ai-autopilot-section {
			margin-top: 2rem;
		}
	}

	.ai-autopilot-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.ai-autopilot-header h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.ai-autopilot-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	@media (min-width: 960px) {
		.ai-autopilot-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.ai-stat-card {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.ai-stat-card.success {
		border-color: rgba(34, 197, 94, 0.35);
	}

	.ai-stat-card.danger {
		border-color: rgba(239, 68, 68, 0.35);
	}

	.ai-stat-value {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.ai-stat-label {
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
	}

	.ai-latest-job {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.ai-latest-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.ai-latest-meta {
		font-size: 0.78rem;
		color: var(--color-text-muted);
		line-height: 1.35;
		margin-top: 0.2rem;
	}

	.ai-empty {
		margin: 0.75rem 0 0;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

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
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
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

	.inline-logo {
		height: 1.2em;
		width: auto;
		vertical-align: middle;
		border-radius: 4px;
	}
</style>
