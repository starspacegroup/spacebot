<script>
	let { data } = $props();
	
	// Calculate percentages for category breakdown - use $derived for reactivity
	const categoryTotal = $derived(Object.values(data.statistics?.events?.byCategory || {}).reduce((a, b) => a + b, 0));
	
	function getCategoryPercentage(count, total) {
		if (!total) return 0;
		return ((count / total) * 100).toFixed(1);
	}
	
	// Format numbers with commas
	function formatNumber(num) {
		if (!num) return '0';
		return num.toLocaleString();
	}
	
	// Calculate success rate
	function getSuccessRate(successful, total) {
		if (!total) return 100;
		return ((successful / total) * 100).toFixed(1);
	}
	
	// Get max value for bar charts
	function getMaxValue(items, key) {
		if (!items?.length) return 1;
		return Math.max(...items.map(i => i[key] || 0));
	}
	
	// Format relative time
	function formatRelativeTime(dateStr) {
		if (!dateStr) return 'Never';
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		
		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}
	
	// Get color for category
	function getCategoryColor(category) {
		const colors = {
			member: '#5865F2',
			message: '#57F287',
			voice: '#FEE75C',
			channel: '#EB459E',
			role: '#ED4245',
			guild: '#9B59B6',
			emoji: '#F1C40F',
			invite: '#3498DB',
			moderation: '#E74C3C',
			interaction: '#1ABC9C',
		};
		return colors[category] || '#78716C';
	}
	
	// Get category icon
	function getCategoryIcon(category) {
		const icons = {
			member: '👤',
			message: '💬',
			voice: '🎤',
			channel: '📁',
			role: '🏷️',
			guild: '⚙️',
			emoji: '😀',
			invite: '📨',
			moderation: '🔨',
			interaction: '⚡',
		};
		return icons[category] || '📊';
	}
	
	// Prepare heatmap grid (7 days x 24 hours)
	const heatmapGrid = $derived.by(() => {
		const grid = Array(7).fill(null).map(() => Array(24).fill(0));
		const maxCount = Math.max(...(data.heatmapData?.map(h => h.count) || [1]), 1);
		
		for (const item of data.heatmapData || []) {
			grid[item.day_of_week][item.hour] = item.count / maxCount;
		}
		
		return grid;
	});
	
	const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	
	// Daily chart data
	const dailyChartData = $derived.by(() => {
		const data_array = data.statistics?.timeSeries?.daily || [];
		const maxCount = Math.max(...data_array.map(d => d.count), 1);
		return data_array.map(d => ({
			...d,
			percentage: (d.count / maxCount) * 100,
			label: new Date(d.period).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
		}));
	});
	
	// Format change with +/- sign
	function formatChange(value) {
		if (!value || value === 0) return '0';
		const sign = value > 0 ? '+' : '';
		return `${sign}${value.toLocaleString()}`;
	}
	
	// Member history chart data with computed values for SVG
	const memberChartData = $derived.by(() => {
		const history = data.memberHistory || [];
		const processed = history.map(d => ({
			...d,
			member_count: d.member_count || 0,
			label: new Date(d.period || d.last_recorded).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
		}));
		
		if (processed.length === 0) return { points: [], minValue: 0, maxValue: 0, range: 1 };
		
		const counts = processed.map(d => d.member_count);
		const minValue = Math.min(...counts);
		const maxValue = Math.max(...counts);
		const range = maxValue - minValue || 1;
		
		return {
			points: processed,
			minValue,
			maxValue,
			range,
			width: processed.length * 30,
		};
	});
</script>

<svelte:head>
	<title>Statistics - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="stats-page">
	<!-- Header -->
	<header class="page-header">
		<div class="header-content">
			<a href="/admin/{data.serverId}" class="back-link">
				<span>←</span>
				Back to Dashboard
			</a>
			<div class="title-section">
				<h1>📊 Statistics</h1>
				<p class="subtitle">Comprehensive analytics for {data.guild?.name || 'your server'}</p>
			</div>
		</div>
	</header>

	{#if !data.statistics}
		<div class="empty-state">
			<div class="empty-icon">📊</div>
			<h2>No Statistics Available</h2>
			<p>Statistics will appear once there is activity in your server.</p>
		</div>
	{:else}
		<!-- Overview Cards -->
		<section class="overview-section">
			<h2 class="section-title">
				<span class="section-icon">📈</span>
				Overview
			</h2>
			<div class="overview-grid">
				<!-- Total Events Card -->
				<div class="stat-card primary">
					<div class="stat-icon">📊</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.statistics.events.total)}</span>
						<span class="stat-label">Total Events</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.events.today)}</span>
							<span class="breakdown-label">Today</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.events.thisWeek)}</span>
							<span class="breakdown-label">This Week</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.events.thisMonth)}</span>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>
				
				<!-- Automations Card -->
				<div class="stat-card">
					<div class="stat-icon">⚡</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.statistics.automations.active)}</span>
						<span class="stat-label">Active Automations</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.automations.total)}</span>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.automations.totalExecutions)}</span>
							<span class="breakdown-label">Executions</span>
						</div>
						<div class="breakdown-item success">
							<span class="breakdown-value">{getSuccessRate(data.statistics.automations.successfulExecutions, data.statistics.automations.totalExecutions)}%</span>
							<span class="breakdown-label">Success Rate</span>
						</div>
					</div>
				</div>
				
				<!-- Commands Card -->
				<div class="stat-card">
					<div class="stat-icon">💬</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.statistics.commands.active)}</span>
						<span class="stat-label">Active Commands</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.commands.total)}</span>
							<span class="breakdown-label">Total</span>
						</div>
						<div class="breakdown-item">
							<span class="breakdown-value">{formatNumber(data.statistics.commands.totalUsage)}</span>
							<span class="breakdown-label">Total Uses</span>
						</div>
					</div>
				</div>
				
				<!-- Members Card -->
				<div class="stat-card members">
					<div class="stat-icon">👥</div>
					<div class="stat-content">
						<span class="stat-value">{formatNumber(data.memberStats?.changes?.current || data.memberStats?.latest?.member_count || 0)}</span>
						<span class="stat-label">Server Members</span>
					</div>
					<div class="stat-breakdown">
						<div class="breakdown-item" class:positive={data.memberStats?.changes?.day > 0} class:negative={data.memberStats?.changes?.day < 0}>
							<span class="breakdown-value">{formatChange(data.memberStats?.changes?.day || 0)}</span>
							<span class="breakdown-label">Today</span>
						</div>
						<div class="breakdown-item" class:positive={data.memberStats?.changes?.week > 0} class:negative={data.memberStats?.changes?.week < 0}>
							<span class="breakdown-value">{formatChange(data.memberStats?.changes?.week || 0)}</span>
							<span class="breakdown-label">This Week</span>
						</div>
						<div class="breakdown-item" class:positive={data.memberStats?.changes?.month > 0} class:negative={data.memberStats?.changes?.month < 0}>
							<span class="breakdown-value">{formatChange(data.memberStats?.changes?.month || 0)}</span>
							<span class="breakdown-label">This Month</span>
						</div>
					</div>
				</div>
			</div>
		</section>
		
		<!-- Member Growth Chart -->
		{#if data.memberHistory?.length > 0}
			<section class="member-chart-section">
				<h2 class="section-title">
					<span class="section-icon">👥</span>
					Member Growth (Last 30 Days)
					{#if data.memberStats?.latest?.recorded_at}
						<span class="last-updated">Last updated: {formatRelativeTime(data.memberStats.latest.recorded_at)}</span>
					{/if}
				</h2>
				<div class="member-chart-container">
					<div class="member-stats-row">
						<div class="member-stat-item">
							<span class="member-stat-label">Current</span>
							<span class="member-stat-value">{formatNumber(data.memberStats?.changes?.current || 0)}</span>
						</div>
						<div class="member-stat-item">
							<span class="member-stat-label">Peak (30d)</span>
							<span class="member-stat-value">{formatNumber(data.memberStats?.peak?.count || 0)}</span>
						</div>
						{#if data.memberStats?.latest?.online_count}
							<div class="member-stat-item online">
								<span class="member-stat-label">Online Now</span>
								<span class="member-stat-value">{formatNumber(data.memberStats.latest.online_count)}</span>
							</div>
						{/if}
						{#if data.memberStats?.latest?.boost_count > 0}
							<div class="member-stat-item boost">
								<span class="member-stat-label">Boosts</span>
								<span class="member-stat-value">{data.memberStats.latest.boost_count} (Lvl {data.memberStats.latest.boost_level})</span>
							</div>
						{/if}
					</div>
					<div class="member-line-chart">
						<svg viewBox="0 0 {memberChartData.width} 150" preserveAspectRatio="none" class="chart-svg">
							<!-- Grid lines -->
							<line x1="0" y1="0" x2="{memberChartData.width}" y2="0" class="grid-line" />
							<line x1="0" y1="50" x2="{memberChartData.width}" y2="50" class="grid-line" />
							<line x1="0" y1="100" x2="{memberChartData.width}" y2="100" class="grid-line" />
							<line x1="0" y1="150" x2="{memberChartData.width}" y2="150" class="grid-line" />
							
							<!-- Area fill -->
							<path 
								d="M 0 150 {memberChartData.points.map((d, i) => `L ${i * 30 + 15} ${150 - ((d.member_count - memberChartData.minValue) / memberChartData.range) * 130}`).join(' ')} L {(memberChartData.points.length - 1) * 30 + 15} 150 Z"
								class="chart-area"
							/>
							
							<!-- Line -->
							<path 
								d="M {memberChartData.points.map((d, i) => `${i * 30 + 15} ${150 - ((d.member_count - memberChartData.minValue) / memberChartData.range) * 130}`).join(' L ')}"
								class="chart-line"
								fill="none"
							/>
							
							<!-- Data points -->
							{#each memberChartData.points as point, i}
								<circle 
									cx="{i * 30 + 15}" 
									cy="{150 - ((point.member_count - memberChartData.minValue) / memberChartData.range) * 130}" 
									r="4" 
									class="chart-point"
								>
									<title>{point.label}: {formatNumber(point.member_count)} members</title>
								</circle>
							{/each}
						</svg>
						<div class="chart-labels">
							{#each memberChartData.points as point, i}
								{#if i === 0 || i === memberChartData.points.length - 1 || i % 7 === 0}
									<span class="chart-label" style="left: {(i / (memberChartData.points.length - 1)) * 100}%">{point.label}</span>
								{/if}
							{/each}
						</div>
					</div>
				</div>
			</section>
		{:else}
			<section class="member-chart-section">
				<h2 class="section-title">
					<span class="section-icon">👥</span>
					Member Growth
				</h2>
				<div class="member-chart-empty">
					<div class="empty-chart-icon">📈</div>
					<p>No member data recorded yet.</p>
					<p class="empty-hint">Member statistics are updated periodically. Check back later to see growth trends.</p>
				</div>
			</section>
		{/if}
		
		<!-- Event Categories -->
		<section class="categories-section">
			<h2 class="section-title">
				<span class="section-icon">📁</span>
				Events by Category
			</h2>
			<div class="categories-grid">
				{#each Object.entries(data.statistics.events.byCategory) as [category, count]}
					<div class="category-card">
						<div class="category-header">
							<span class="category-icon" style="background-color: {getCategoryColor(category)}15; color: {getCategoryColor(category)}">
								{getCategoryIcon(category)}
							</span>
							<span class="category-name">{category}</span>
						</div>
						<div class="category-stats">
							<span class="category-count">{formatNumber(count)}</span>
							<span class="category-percent">{getCategoryPercentage(count, categoryTotal)}%</span>
						</div>
						<div class="category-bar">
							<div 
								class="category-bar-fill" 
								style="width: {getCategoryPercentage(count, categoryTotal)}%; background-color: {getCategoryColor(category)}"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</section>
		
		<!-- Activity Chart -->
		<section class="chart-section">
			<h2 class="section-title">
				<span class="section-icon">📈</span>
				Activity (Last 30 Days)
			</h2>
			<div class="chart-container">
				{#if dailyChartData.length > 0}
					<div class="bar-chart">
						{#each dailyChartData as day, i}
							<div class="bar-wrapper" title="{day.label}: {day.count} events">
								<div class="bar" style="height: {Math.max(day.percentage, 2)}%"></div>
								{#if i % 5 === 0 || i === dailyChartData.length - 1}
									<span class="bar-label">{day.label}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="chart-empty">
						<span>No activity data available</span>
					</div>
				{/if}
			</div>
		</section>
		
		<!-- Activity Heatmap -->
		<section class="heatmap-section">
			<h2 class="section-title">
				<span class="section-icon">🗓️</span>
				Activity Heatmap (Last 30 Days)
			</h2>
			<div class="heatmap-container">
				<div class="heatmap-hours">
					{#each Array(24) as _, hour}
						{#if hour % 3 === 0}
							<span class="hour-label">{hour}:00</span>
						{/if}
					{/each}
				</div>
				<div class="heatmap-grid">
					{#each heatmapGrid as dayData, dayIndex}
						<div class="heatmap-row">
							<span class="day-label">{dayLabels[dayIndex]}</span>
							{#each dayData as intensity, hourIndex}
								<div 
									class="heatmap-cell" 
									style="opacity: {0.1 + (intensity * 0.9)}"
									title="{dayLabels[dayIndex]} {hourIndex}:00 - Activity: {Math.round(intensity * 100)}%"
								></div>
							{/each}
						</div>
					{/each}
				</div>
				<div class="heatmap-legend">
					<span>Less</span>
					<div class="legend-scale">
						<div class="legend-cell" style="opacity: 0.1"></div>
						<div class="legend-cell" style="opacity: 0.3"></div>
						<div class="legend-cell" style="opacity: 0.5"></div>
						<div class="legend-cell" style="opacity: 0.7"></div>
						<div class="legend-cell" style="opacity: 1"></div>
					</div>
					<span>More</span>
				</div>
			</div>
		</section>
		
		<div class="two-column-section">
			<!-- Top Event Types -->
			<section class="list-section">
				<h2 class="section-title">
					<span class="section-icon">🏆</span>
					Top Event Types
				</h2>
				<div class="list-container">
					{#if data.statistics.events.byType?.length > 0}
						{#each data.statistics.events.byType as eventType, i}
							{@const maxCount = getMaxValue(data.statistics.events.byType, 'count')}
							<div class="list-item">
								<span class="list-rank">#{i + 1}</span>
								<div class="list-info">
									<span class="list-name">{eventType.event_type}</span>
									<span class="list-category" style="color: {getCategoryColor(eventType.event_category)}">
										{getCategoryIcon(eventType.event_category)} {eventType.event_category}
									</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(eventType.count / maxCount) * 100}%; background-color: {getCategoryColor(eventType.event_category)}"
									></div>
								</div>
								<span class="list-count">{formatNumber(eventType.count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No event data available</div>
					{/if}
				</div>
			</section>
			
			<!-- Top Channels -->
			<section class="list-section">
				<h2 class="section-title">
					<span class="section-icon">📢</span>
					Most Active Channels
				</h2>
				<div class="list-container">
					{#if data.statistics.topChannels?.length > 0}
						{#each data.statistics.topChannels as channel, i}
							{@const maxCount = getMaxValue(data.statistics.topChannels, 'event_count')}
							<div class="list-item">
								<span class="list-rank">#{i + 1}</span>
								<div class="list-info">
									<span class="list-name">#{channel.channel_name || 'Unknown'}</span>
									<span class="list-meta">{channel.event_types} event types</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(channel.event_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(channel.event_count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No channel data available</div>
					{/if}
				</div>
			</section>
		</div>
		
		<div class="two-column-section">
			<!-- Top Users -->
			<section class="list-section">
				<h2 class="section-title">
					<span class="section-icon">👤</span>
					Most Active Users
				</h2>
				<div class="list-container">
					{#if data.statistics.topActors?.length > 0}
						{#each data.statistics.topActors as actor, i}
							{@const maxCount = getMaxValue(data.statistics.topActors, 'event_count')}
							<div class="list-item">
								<span class="list-rank">#{i + 1}</span>
								<div class="list-info">
									<span class="list-name">{actor.actor_name || 'Unknown User'}</span>
									<span class="list-meta">{actor.event_types} event types</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar" 
										style="width: {(actor.event_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(actor.event_count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No user data available</div>
					{/if}
				</div>
			</section>
			
			<!-- Command Usage -->
			<section class="list-section">
				<h2 class="section-title">
					<span class="section-icon">💬</span>
					Command Usage
				</h2>
				<div class="list-container">
					{#if data.statistics.commandUsage?.length > 0}
						{#each data.statistics.commandUsage as command, i}
							{@const maxCount = getMaxValue(data.statistics.commandUsage, 'use_count')}
							<div class="list-item">
								<span class="list-rank">#{i + 1}</span>
								<div class="list-info">
									<span class="list-name">/{command.name}</span>
									<span class="list-meta">{command.enabled ? '✅ Active' : '❌ Disabled'}</span>
								</div>
								<div class="list-bar-container">
									<div 
										class="list-bar command" 
										style="width: {(command.use_count / maxCount) * 100}%"
									></div>
								</div>
								<span class="list-count">{formatNumber(command.use_count)}</span>
							</div>
						{/each}
					{:else}
						<div class="list-empty">No command usage data</div>
					{/if}
				</div>
			</section>
		</div>
		
		<!-- Automation Performance -->
		<section class="performance-section">
			<h2 class="section-title">
				<span class="section-icon">⚡</span>
				Automation Performance
			</h2>
			{#if data.statistics.automationPerformance?.length > 0}
				<div class="performance-grid">
					{#each data.statistics.automationPerformance as automation}
						{@const successRate = automation.log_count > 0 ? (automation.success_count / automation.log_count) * 100 : 100}
						<div class="performance-card">
							<div class="performance-header">
								<span class="performance-name">{automation.name}</span>
								<span class="performance-status" class:success={successRate >= 90} class:warning={successRate >= 50 && successRate < 90} class:error={successRate < 50}>
									{successRate.toFixed(0)}% success
								</span>
							</div>
							<div class="performance-stats">
								<div class="perf-stat">
									<span class="perf-value">{formatNumber(automation.trigger_count)}</span>
									<span class="perf-label">Triggers</span>
								</div>
								<div class="perf-stat">
									<span class="perf-value">{formatNumber(automation.log_count)}</span>
									<span class="perf-label">Executions</span>
								</div>
								<div class="perf-stat">
									<span class="perf-value">{automation.avg_execution_time ? Math.round(automation.avg_execution_time) + 'ms' : 'N/A'}</span>
									<span class="perf-label">Avg Time</span>
								</div>
							</div>
							<div class="performance-bar">
								<div class="perf-bar-fill" style="width: {successRate}%"></div>
							</div>
							<span class="performance-last">Last triggered: {formatRelativeTime(automation.last_triggered_at)}</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No automations configured yet</span>
					<a href="/admin/{data.serverId}/automations/new" class="btn btn-primary btn-sm">Create Automation</a>
				</div>
			{/if}
		</section>
		
		<!-- Recent Automation Executions -->
		<section class="executions-section">
			<h2 class="section-title">
				<span class="section-icon">📜</span>
				Recent Automation Executions
			</h2>
			{#if data.recentExecutions?.length > 0}
				<div class="executions-table">
					<div class="table-header">
						<span class="col-status">Status</span>
						<span class="col-automation">Automation</span>
						<span class="col-trigger">Trigger</span>
						<span class="col-time">Execution Time</span>
						<span class="col-when">When</span>
					</div>
					{#each data.recentExecutions as execution}
						<div class="table-row" class:error={!execution.success}>
							<span class="col-status">
								{#if execution.success}
									<span class="status-badge success">✓</span>
								{:else}
									<span class="status-badge error" title={execution.error_message}>✗</span>
								{/if}
							</span>
							<span class="col-automation">{execution.automation_name}</span>
							<span class="col-trigger">{execution.trigger_event}</span>
							<span class="col-time">{execution.execution_time_ms ? execution.execution_time_ms + 'ms' : 'N/A'}</span>
							<span class="col-when">{formatRelativeTime(execution.created_at)}</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-list">
					<span>No recent automation executions</span>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.stats-page {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.stats-page {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.stats-page {
			padding: 2rem;
		}
	}
	
	/* Header */
	.page-header {
		margin-bottom: 2rem;
	}
	
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
		transition: color var(--transition-fast);
	}
	
	.back-link:hover {
		color: var(--color-primary);
	}
	
	.title-section h1 {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0;
		color: var(--color-text);
	}
	
	.subtitle {
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
	}
	
	/* Section Titles */
	.section-title {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	.section-icon {
		font-size: 1rem;
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}
	
	.empty-state h2 {
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}
	
	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}
	
	/* Overview Section */
	.overview-section {
		margin-bottom: 2rem;
	}
	
	.overview-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	
	@media (min-width: 768px) {
		.overview-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}
	
	.stat-card.primary {
		border-color: var(--color-primary);
		background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-primary-soft) 100%);
	}
	
	.stat-icon {
		font-size: 2rem;
		margin-bottom: 0.75rem;
	}
	
	.stat-content {
		margin-bottom: 1rem;
	}
	
	.stat-value {
		display: block;
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.2;
	}
	
	.stat-label {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	.stat-breakdown {
		display: flex;
		gap: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}
	
	.breakdown-item {
		display: flex;
		flex-direction: column;
	}
	
	.breakdown-value {
		font-weight: 600;
		color: var(--color-text);
	}
	
	.breakdown-item.success .breakdown-value {
		color: var(--color-success);
	}
	
	.breakdown-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	/* Categories Section */
	.categories-section {
		margin-bottom: 2rem;
	}
	
	.categories-grid {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(2, 1fr);
	}
	
	@media (min-width: 768px) {
		.categories-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	@media (min-width: 1024px) {
		.categories-grid {
			grid-template-columns: repeat(5, 1fr);
		}
	}
	
	.category-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
	}
	
	.category-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	
	.category-icon {
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
	}
	
	.category-name {
		font-weight: 500;
		text-transform: capitalize;
		color: var(--color-text);
		font-size: 0.9rem;
	}
	
	.category-stats {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	
	.category-count {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}
	
	.category-percent {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	
	.category-bar {
		height: 4px;
		background: var(--color-surface-elevated);
		border-radius: 2px;
		overflow: hidden;
	}
	
	.category-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width var(--transition-normal);
	}
	
	/* Chart Section */
	.chart-section {
		margin-bottom: 2rem;
	}
	
	.chart-container {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		min-height: 200px;
	}
	
	.bar-chart {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 150px;
	}
	
	.bar-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		position: relative;
	}
	
	.bar {
		width: 100%;
		background: var(--color-primary);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
		transition: height var(--transition-fast);
	}
	
	.bar-wrapper:hover .bar {
		background: var(--color-primary-hover);
	}
	
	.bar-label {
		position: absolute;
		bottom: -20px;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	
	.chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 150px;
		color: var(--color-text-muted);
	}
	
	/* Heatmap Section */
	.heatmap-section {
		margin-bottom: 2rem;
	}
	
	.heatmap-container {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		overflow-x: auto;
	}
	
	.heatmap-hours {
		display: flex;
		margin-left: 50px;
		margin-bottom: 0.5rem;
	}
	
	.hour-label {
		width: calc(100% / 8);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}
	
	.heatmap-grid {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	
	.heatmap-row {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	
	.day-label {
		width: 40px;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}
	
	.heatmap-cell {
		flex: 1;
		height: 18px;
		background: var(--color-primary);
		border-radius: 2px;
		min-width: 12px;
		transition: transform var(--transition-fast);
	}
	
	.heatmap-cell:hover {
		transform: scale(1.2);
		z-index: 1;
	}
	
	.heatmap-legend {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	.legend-scale {
		display: flex;
		gap: 2px;
	}
	
	.legend-cell {
		width: 14px;
		height: 14px;
		background: var(--color-primary);
		border-radius: 2px;
	}
	
	/* Two Column Layout */
	.two-column-section {
		display: grid;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}
	
	@media (min-width: 768px) {
		.two-column-section {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	/* List Section */
	.list-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
	}
	
	.list-section .section-title {
		margin-bottom: 0.75rem;
	}
	
	.list-container {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 400px;
		overflow-y: auto;
	}
	
	.list-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
	}
	
	.list-rank {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		width: 24px;
	}
	
	.list-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	
	.list-name {
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.list-category,
	.list-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	.list-bar-container {
		width: 60px;
		height: 6px;
		background: var(--color-surface);
		border-radius: 3px;
		overflow: hidden;
	}
	
	.list-bar {
		height: 100%;
		background: var(--color-primary);
		border-radius: 3px;
		transition: width var(--transition-normal);
	}
	
	.list-bar.command {
		background: var(--discord-blurple);
	}
	
	.list-count {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.85rem;
		min-width: 40px;
		text-align: right;
	}
	
	.list-empty {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted);
	}
	
	/* Performance Section */
	.performance-section {
		margin-bottom: 2rem;
	}
	
	.performance-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	
	@media (min-width: 640px) {
		.performance-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	@media (min-width: 1024px) {
		.performance-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	.performance-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}
	
	.performance-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	
	.performance-name {
		font-weight: 600;
		color: var(--color-text);
	}
	
	.performance-status {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
	}
	
	.performance-status.success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	
	.performance-status.warning {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	
	.performance-status.error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}
	
	.performance-stats {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}
	
	.perf-stat {
		display: flex;
		flex-direction: column;
	}
	
	.perf-value {
		font-weight: 600;
		color: var(--color-text);
	}
	
	.perf-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}
	
	.performance-bar {
		height: 4px;
		background: var(--color-surface-elevated);
		border-radius: 2px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}
	
	.perf-bar-fill {
		height: 100%;
		background: var(--color-success);
		border-radius: 2px;
	}
	
	.performance-last {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	.empty-list {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		color: var(--color-text-muted);
	}
	
	/* Executions Section */
	.executions-section {
		margin-bottom: 2rem;
	}
	
	.executions-table {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	
	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: 50px 1fr 1fr 100px 100px;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		align-items: center;
	}
	
	.table-header {
		background: var(--color-surface-elevated);
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}
	
	.table-row {
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
	}
	
	.table-row.error {
		background: var(--color-danger-soft);
	}
	
	.status-badge {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 600;
	}
	
	.status-badge.success {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	
	.status-badge.error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}
	
	.col-automation,
	.col-trigger {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	.col-time,
	.col-when {
		font-size: 0.85rem;
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
		color: #1C1917;
	}
	
	.btn-primary:hover {
		background: var(--color-primary-hover);
	}
	
	.btn-sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}
	
	/* Responsive table */
	@media (max-width: 640px) {
		.table-header {
			display: none;
		}
		
		.table-row {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
		
		.table-row > span:not(.col-status) {
			padding-left: 2rem;
		}
		
		.col-status {
			position: absolute;
		}
	}
	
	/* Members Card */
	.stat-card.members {
		border-color: var(--discord-blurple);
		background: linear-gradient(135deg, var(--color-surface) 0%, rgba(88, 101, 242, 0.1) 100%);
	}
	
	.breakdown-item.positive .breakdown-value {
		color: var(--color-success);
	}
	
	.breakdown-item.positive .breakdown-value::before {
		content: '';
	}
	
	.breakdown-item.negative .breakdown-value {
		color: var(--color-danger);
	}
	
	/* Member Chart Section */
	.member-chart-section {
		margin-bottom: 2rem;
	}
	
	.member-chart-section .section-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	
	.last-updated {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
		margin-left: auto;
	}
	
	.member-chart-container {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
	}
	
	.member-stats-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}
	
	.member-stat-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.member-stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}
	
	.member-stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}
	
	.member-stat-item.online .member-stat-value {
		color: var(--color-success);
	}
	
	.member-stat-item.boost .member-stat-value {
		color: #f47fff;
	}
	
	/* Member Line Chart */
	.member-line-chart {
		position: relative;
		height: 180px;
		margin-bottom: 1.5rem;
	}
	
	.chart-svg {
		width: 100%;
		height: 150px;
	}
	
	.grid-line {
		stroke: var(--color-border);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}
	
	.chart-area {
		fill: rgba(88, 101, 242, 0.15);
	}
	
	.chart-line {
		stroke: var(--discord-blurple);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	
	.chart-point {
		fill: var(--discord-blurple);
		stroke: var(--color-surface);
		stroke-width: 2;
		cursor: pointer;
		transition: r var(--transition-fast);
	}
	
	.chart-point:hover {
		r: 6;
	}
	
	.chart-labels {
		position: relative;
		height: 20px;
		margin-top: 0.5rem;
	}
	
	.chart-label {
		position: absolute;
		transform: translateX(-50%);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	
	.member-chart-empty {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 3rem 2rem;
		text-align: center;
	}
	
	.empty-chart-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
		opacity: 0.5;
	}
	
	.member-chart-empty p {
		margin: 0;
		color: var(--color-text-muted);
	}
	
	.empty-hint {
		font-size: 0.85rem;
		margin-top: 0.5rem !important;
	}
	
	/* Overview grid with 4 columns for members card */
	@media (min-width: 768px) {
		.overview-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	@media (min-width: 1024px) {
		.overview-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
