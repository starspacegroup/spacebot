<script>
	import { onMount } from 'svelte';
	
	let { data } = $props();
	
	// State
	let logs = $state([]);
	let loading = $state(true);
	let error = $state(null);
	let stats = $state(null);
	let total = $state(0);
	let hasMore = $state(false);
	
	// Filters
	let selectedCategory = $state('');
	let selectedEventType = $state('');
	let searchQuery = $state('');
	let startDate = $state('');
	let endDate = $state('');
	
	// Pagination
	let offset = $state(0);
	let limit = $state(50);
	
	// Metadata
	let categories = $state({});
	let eventTypes = $state({});
	
	// Auto-refresh
	let autoRefresh = $state(true);
	let refreshInterval = $state(null);
	
	async function fetchLogs(append = false) {
		console.log('[DEBUG] fetchLogs called, append:', append);
		if (!append) {
			loading = true;
			offset = 0;
		}
		
		try {
			const params = new URLSearchParams({
				limit: limit.toString(),
				offset: offset.toString(),
				stats: (!append).toString()
			});
			
			if (selectedCategory) params.set('category', selectedCategory);
			if (selectedEventType) params.set('eventType', selectedEventType);
			if (searchQuery) params.set('search', searchQuery);
			if (startDate) params.set('startDate', startDate);
			if (endDate) params.set('endDate', endDate);
			
			const url = `/api/logs/${data.serverId}?${params}`;
			console.log('[DEBUG] Fetching from:', url);
			const response = await fetch(url);
			
			if (!response.ok) {
				throw new Error('Failed to fetch logs');
			}
			
			const result = await response.json();
			console.log('[DEBUG] API response:', result);
			
			if (append) {
				logs = [...logs, ...result.logs];
			} else {
				logs = result.logs;
				categories = result.categories || {};
				eventTypes = result.eventTypes || {};
				if (result.stats) {
					stats = result.stats;
				}
			}
			
			total = result.total;
			hasMore = result.hasMore;
			error = null;
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
	
	function loadMore() {
		offset += limit;
		fetchLogs(true);
	}
	
	function applyFilters() {
		fetchLogs();
	}
	
	function clearFilters() {
		selectedCategory = '';
		selectedEventType = '';
		searchQuery = '';
		startDate = '';
		endDate = '';
		fetchLogs();
	}
	
	function formatDate(dateString) {
		const date = new Date(dateString);
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(date);
	}
	
	function getEventIcon(category) {
		return categories[category]?.icon || '📌';
	}
	
	function getEventColor(category) {
		return categories[category]?.color || '#888';
	}
	
	function getCategoryName(category) {
		return categories[category]?.name || category;
	}
	
	function getEventDescription(eventType) {
		return eventTypes[eventType]?.description || eventType;
	}
	
	function toggleAutoRefresh() {
		autoRefresh = !autoRefresh;
		if (autoRefresh) {
			startAutoRefresh();
		} else {
			stopAutoRefresh();
		}
	}
	
	function startAutoRefresh() {
		refreshInterval = setInterval(() => {
			if (!loading) {
				fetchLogs();
			}
		}, 10000); // Refresh every 10 seconds
	}
	
	function stopAutoRefresh() {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
	}
	
	onMount(() => {
		console.log('[DEBUG] onMount - botInGuild:', data.botInGuild, 'serverId:', data.serverId);
		if (data.botInGuild) {
			fetchLogs();
			if (autoRefresh) {
				startAutoRefresh();
			}
		}
		
		return () => {
			stopAutoRefresh();
		};
	});
	
	// Get event types for selected category
	let filteredEventTypes = $derived(() => {
		if (!selectedCategory) return Object.keys(eventTypes);
		return Object.entries(eventTypes)
			.filter(([_, info]) => info.category === selectedCategory)
			.map(([type, _]) => type);
	});
</script>

<svelte:head>
	<title>Server Logs - {data.guild?.name || 'Unknown'} | SpaceBot Admin</title>
</svelte:head>

<div class="logs-container">
	<header class="logs-header">
		<div class="header-left">
			<a href="/admin" class="back-link">← Back to Admin</a>
			<div class="guild-info">
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
		<div class="header-right">
			<button 
				class="refresh-btn" 
				class:active={autoRefresh}
				onclick={toggleAutoRefresh}
			>
				{autoRefresh ? '⏸ Pause' : '▶ Auto-refresh'}
			</button>
			<button class="refresh-btn" onclick={() => fetchLogs()} disabled={loading}>
				🔄 Refresh
			</button>
		</div>
	</header>
	
	{#if !data.botInGuild}
		<div class="error-card">
			<h2>⚠️ Bot Not Installed</h2>
			<p>The bot is not installed in this server. Add the bot to start logging events.</p>
			<a href="/api/auth/discord?flow=install" class="btn">Add Bot to Server</a>
		</div>
	{:else}
		<!-- Stats Section -->
		{#if stats}
			<div class="stats-grid">
				<div class="stat-card">
					<span class="stat-value">{stats.totalEvents.toLocaleString()}</span>
					<span class="stat-label">Total Events</span>
				</div>
				{#each Object.entries(stats.byCategory || {}) as [cat, count]}
					<div class="stat-card" style="--cat-color: {getEventColor(cat)}">
						<span class="stat-icon">{getEventIcon(cat)}</span>
						<span class="stat-value">{count.toLocaleString()}</span>
						<span class="stat-label">{getCategoryName(cat)}</span>
					</div>
				{/each}
			</div>
		{/if}
		
		<!-- Filters Section -->
		<div class="filters-section">
			<div class="filters-row">
				<div class="filter-group">
					<label for="category">Category</label>
					<select id="category" bind:value={selectedCategory} onchange={applyFilters}>
						<option value="">All Categories</option>
						{#each Object.entries(categories) as [key, info]}
							<option value={key}>{info.icon} {info.name}</option>
						{/each}
					</select>
				</div>
				
				<div class="filter-group">
					<label for="eventType">Event Type</label>
					<select id="eventType" bind:value={selectedEventType} onchange={applyFilters}>
						<option value="">All Events</option>
						{#each filteredEventTypes() as type}
							<option value={type}>{type.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				</div>
				
				<div class="filter-group">
					<label for="search">Search</label>
					<input 
						id="search" 
						type="text" 
						placeholder="Search users, channels..." 
						bind:value={searchQuery}
						onkeydown={(e) => e.key === 'Enter' && applyFilters()}
					/>
				</div>
				
				<div class="filter-group">
					<label for="startDate">From</label>
					<input 
						id="startDate" 
						type="datetime-local" 
						bind:value={startDate}
						onchange={applyFilters}
					/>
				</div>
				
				<div class="filter-group">
					<label for="endDate">To</label>
					<input 
						id="endDate" 
						type="datetime-local" 
						bind:value={endDate}
						onchange={applyFilters}
					/>
				</div>
				
				<button class="clear-btn" onclick={clearFilters}>Clear Filters</button>
			</div>
		</div>
		
		<!-- Results Info -->
		<div class="results-info">
			<span>Showing {logs.length} of {total.toLocaleString()} events</span>
			{#if loading}
				<span class="loading-indicator">Loading...</span>
			{/if}
		</div>
		
		<!-- Logs Table -->
		{#if error}
			<div class="error-card">
				<p>Error: {error}</p>
			</div>
		{:else if logs.length === 0 && !loading}
			<div class="empty-state">
				<h3>📭 No Events Found</h3>
				<p>No events match your filters, or no events have been logged yet.</p>
				<p class="hint">Events are logged when the Gateway bot is running.</p>
			</div>
		{:else}
			<div class="logs-table-container">
				<table class="logs-table">
					<thead>
						<tr>
							<th>Time</th>
							<th>Event</th>
							<th>Actor</th>
							<th>Target</th>
							<th>Channel</th>
							<th>Details</th>
						</tr>
					</thead>
					<tbody>
						{#each logs as log}
							<tr>
								<td class="time-cell">
									{formatDate(log.created_at)}
								</td>
								<td class="event-cell">
									<span 
										class="event-badge" 
										style="--event-color: {getEventColor(log.event_category)}"
									>
										<span class="event-icon">{getEventIcon(log.event_category)}</span>
										<span class="event-type">{log.event_type.replace(/_/g, ' ')}</span>
									</span>
								</td>
								<td class="actor-cell">
									{#if log.actor_name}
										<span class="user-tag">{log.actor_name}</span>
										{#if log.actor_id}
											<span class="user-id">{log.actor_id}</span>
										{/if}
									{:else}
										<span class="na">—</span>
									{/if}
								</td>
								<td class="target-cell">
									{#if log.target_name}
										<span class="target-name">{log.target_name}</span>
										{#if log.target_id}
											<span class="target-id">{log.target_id}</span>
										{/if}
									{:else}
										<span class="na">—</span>
									{/if}
								</td>
								<td class="channel-cell">
									{#if log.channel_name}
										<span class="channel-name">#{log.channel_name}</span>
									{:else}
										<span class="na">—</span>
									{/if}
								</td>
								<td class="details-cell">
									{#if log.details}
										<a 
											href="/admin/{data.serverId}/logs/{log.id}"
											class="details-btn"
										>
											View Details
										</a>
									{:else}
										<a 
											href="/admin/{data.serverId}/logs/{log.id}"
											class="details-btn secondary"
										>
											View
										</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			
			{#if hasMore}
				<div class="load-more">
					<button onclick={loadMore} disabled={loading}>
						{loading ? 'Loading...' : 'Load More'}
					</button>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.logs-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}
	
	.logs-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		flex-wrap: wrap;
		gap: 1rem;
	}
	
	.header-left {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.back-link {
		color: var(--text-secondary, #888);
		text-decoration: none;
		font-size: 0.875rem;
	}
	
	.back-link:hover {
		color: var(--text-primary, #fff);
	}
	
	.guild-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	
	.guild-icon, .guild-icon-placeholder {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.guild-icon-placeholder {
		background: var(--bg-secondary, #333);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: bold;
		color: var(--text-primary, #fff);
	}
	
	.guild-text h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	
	.guild-id {
		color: var(--text-secondary, #888);
		font-size: 0.75rem;
		font-family: monospace;
	}
	
	.header-right {
		display: flex;
		gap: 0.5rem;
	}
	
	.refresh-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border-color, #444);
		background: var(--bg-secondary, #222);
		color: var(--text-primary, #fff);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.875rem;
	}
	
	.refresh-btn:hover {
		background: var(--bg-tertiary, #333);
	}
	
	.refresh-btn.active {
		background: var(--accent-color, #5865F2);
		border-color: var(--accent-color, #5865F2);
	}
	
	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	/* Stats Grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}
	
	.stat-card {
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1rem;
		text-align: center;
		border-left: 3px solid var(--cat-color, var(--accent-color, #5865F2));
	}
	
	.stat-icon {
		font-size: 1.5rem;
		display: block;
		margin-bottom: 0.25rem;
	}
	
	.stat-value {
		font-size: 1.5rem;
		font-weight: bold;
		display: block;
	}
	
	.stat-label {
		font-size: 0.75rem;
		color: var(--text-secondary, #888);
		text-transform: uppercase;
	}
	
	/* Filters */
	.filters-section {
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	
	.filters-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: flex-end;
	}
	
	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 150px;
	}
	
	.filter-group label {
		font-size: 0.75rem;
		color: var(--text-secondary, #888);
		text-transform: uppercase;
	}
	
	.filter-group select,
	.filter-group input {
		padding: 0.5rem;
		border: 1px solid var(--border-color, #444);
		background: var(--bg-primary, #111);
		color: var(--text-primary, #fff);
		border-radius: 4px;
		font-size: 0.875rem;
	}
	
	.clear-btn {
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px solid var(--border-color, #444);
		color: var(--text-secondary, #888);
		border-radius: 4px;
		cursor: pointer;
		white-space: nowrap;
	}
	
	.clear-btn:hover {
		color: var(--text-primary, #fff);
		border-color: var(--text-primary, #fff);
	}
	
	/* Results Info */
	.results-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		color: var(--text-secondary, #888);
		font-size: 0.875rem;
	}
	
	.loading-indicator {
		color: var(--accent-color, #5865F2);
	}
	
	/* Logs Table */
	.logs-table-container {
		overflow-x: auto;
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
	}
	
	.logs-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	
	.logs-table th {
		background: var(--bg-secondary, #222);
		padding: 0.75rem 1rem;
		text-align: left;
		font-weight: 600;
		color: var(--text-secondary, #888);
		text-transform: uppercase;
		font-size: 0.75rem;
		border-bottom: 1px solid var(--border-color, #333);
	}
	
	.logs-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-color, #222);
		vertical-align: top;
	}
	
	.logs-table tr:hover td {
		background: var(--bg-secondary, #1a1a1a);
	}
	
	.time-cell {
		white-space: nowrap;
		color: var(--text-secondary, #888);
		font-family: monospace;
		font-size: 0.8rem;
	}
	
	.event-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		background: color-mix(in srgb, var(--event-color) 20%, transparent);
		border: 1px solid var(--event-color);
		border-radius: 4px;
		font-size: 0.75rem;
	}
	
	.event-type {
		font-weight: 500;
	}
	
	.user-tag, .target-name, .channel-name {
		display: block;
		font-weight: 500;
	}
	
	.user-id, .target-id {
		display: block;
		font-size: 0.7rem;
		color: var(--text-secondary, #666);
		font-family: monospace;
	}
	
	.channel-name {
		color: var(--accent-color, #5865F2);
	}
	
	.na {
		color: var(--text-secondary, #555);
	}
	
	.details-btn {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		background: var(--bg-secondary, #333);
		border: 1px solid var(--border-color, #444);
		color: var(--text-primary, #fff);
		border-radius: 4px;
		cursor: pointer;
		text-decoration: none;
		text-align: center;
	}
	
	.details-btn:hover {
		background: var(--bg-tertiary, #444);
	}
	
	.details-btn.secondary {
		background: transparent;
		color: var(--text-secondary, #888);
	}
	
	.details-btn.secondary:hover {
		color: var(--text-primary, #fff);
		background: var(--bg-secondary, #333);
	}
	
	.details-cell {
		white-space: nowrap;
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 3rem;
		background: var(--bg-secondary, #222);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
	}
	
	.empty-state h3 {
		margin: 0 0 0.5rem;
	}
	
	.empty-state p {
		color: var(--text-secondary, #888);
		margin: 0.5rem 0;
	}
	
	.empty-state .hint {
		font-size: 0.875rem;
		font-style: italic;
	}
	
	/* Error Card */
	.error-card {
		background: color-mix(in srgb, #ED4245 20%, var(--bg-secondary, #222));
		border: 1px solid #ED4245;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
	}
	
	.error-card h2 {
		margin: 0 0 1rem;
	}
	
	.btn {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		background: var(--accent-color, #5865F2);
		color: white;
		text-decoration: none;
		border-radius: 6px;
		font-weight: 500;
		margin-top: 1rem;
	}
	
	.btn:hover {
		background: color-mix(in srgb, var(--accent-color, #5865F2) 80%, white);
	}
	
	/* Load More */
	.load-more {
		text-align: center;
		padding: 1.5rem;
	}
	
	.load-more button {
		padding: 0.75rem 2rem;
		background: var(--bg-secondary, #333);
		border: 1px solid var(--border-color, #444);
		color: var(--text-primary, #fff);
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
	}
	
	.load-more button:hover {
		background: var(--bg-tertiary, #444);
	}
	
	.load-more button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	/* Responsive */
	@media (max-width: 768px) {
		.logs-container {
			padding: 1rem;
		}
		
		.filters-row {
			flex-direction: column;
		}
		
		.filter-group {
			width: 100%;
		}
		
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
