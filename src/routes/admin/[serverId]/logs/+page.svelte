<script>
	import { onMount } from 'svelte';
	import { log } from '$lib/log.js';
	
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
	
	// Sorting
	let sortOrder = $state('desc'); // 'desc' = newest first, 'asc' = oldest first
	
	// Pagination
	let offset = $state(0);
	let limit = $state(25);
	let currentPage = $state(1);
	const pageSizeOptions = [10, 25, 50, 100];
	
	// Metadata
	let categories = $state({});
	let eventTypes = $state({});
	
	// Auto-refresh
	let autoRefresh = $state(true);
	let refreshInterval = $state(null);
	
	async function fetchLogs(append = false) {
		log.debug('[DEBUG] fetchLogs called, append:', append);
		if (!append) {
			loading = true;
			offset = 0;
		}
		
		try {
			const params = new URLSearchParams({
				limit: limit.toString(),
				offset: offset.toString(),
				stats: (!append).toString(),
				sortOrder: sortOrder
			});
			
			if (selectedCategory) params.set('category', selectedCategory);
			if (selectedEventType) params.set('eventType', selectedEventType);
			if (searchQuery) params.set('search', searchQuery);
			if (startDate) params.set('startDate', startDate);
			if (endDate) params.set('endDate', endDate);
			
			const url = `/api/logs/${data.serverId}?${params}`;
			log.debug('[DEBUG] Fetching from:', url);
			const response = await fetch(url);
			
			if (!response.ok) {
				throw new Error('Failed to fetch logs');
			}
			
			const result = await response.json();
			log.debug('[DEBUG] API response:', result);
			
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
	
	// Pagination computed values
	let totalPages = $derived(Math.ceil(total / limit) || 1);
	
	function goToPage(page) {
		if (page < 1 || page > totalPages) return;
		currentPage = page;
		offset = (page - 1) * limit;
		fetchLogs();
	}
	
	function changePageSize(newSize) {
		limit = newSize;
		currentPage = 1;
		offset = 0;
		fetchLogs();
	}
	
	function toggleSortOrder() {
		sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
		currentPage = 1;
		offset = 0;
		fetchLogs();
	}
	
	function applyFilters() {
		currentPage = 1;
		fetchLogs();
	}
	
	function clearFilters() {
		selectedCategory = '';
		selectedEventType = '';
		searchQuery = '';
		startDate = '';
		endDate = '';
		sortOrder = 'desc';
		currentPage = 1;
		offset = 0;
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
		log.debug('[DEBUG] onMount - botInGuild:', data.botInGuild, 'serverId:', data.serverId);
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
		
		<!-- Results Info & Pagination Controls -->
		<div class="results-info">
			<div class="results-left">
				<span>Showing {logs.length} of {total.toLocaleString()} events</span>
				{#if loading}
					<span class="loading-indicator">Loading...</span>
				{/if}
			</div>
			<div class="results-right">
				<div class="page-size-selector">
					<label for="pageSize">Per page:</label>
					<select id="pageSize" bind:value={limit} onchange={() => changePageSize(limit)}>
						{#each pageSizeOptions as size}
							<option value={size}>{size}</option>
						{/each}
					</select>
				</div>
				<div class="pagination-controls">
					<button 
						class="pagination-btn" 
						onclick={() => goToPage(1)} 
						disabled={currentPage === 1 || loading}
						title="First page"
					>
						⏮
					</button>
					<button 
						class="pagination-btn" 
						onclick={() => goToPage(currentPage - 1)} 
						disabled={currentPage === 1 || loading}
						title="Previous page"
					>
						◀
					</button>
					<span class="page-info">Page {currentPage} of {totalPages}</span>
					<button 
						class="pagination-btn" 
						onclick={() => goToPage(currentPage + 1)} 
						disabled={currentPage >= totalPages || loading}
						title="Next page"
					>
						▶
					</button>
					<button 
						class="pagination-btn" 
						onclick={() => goToPage(totalPages)} 
						disabled={currentPage >= totalPages || loading}
						title="Last page"
					>
						⏭
					</button>
				</div>
			</div>
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
							<th class="sortable" onclick={toggleSortOrder}>
								Time 
								<span class="sort-indicator">{sortOrder === 'desc' ? '↓' : '↑'}</span>
								<span class="sort-hint">{sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}</span>
							</th>
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
			
			<!-- Bottom Pagination -->
			{#if total > limit}
				<div class="bottom-pagination">
					<div class="pagination-controls">
						<button 
							class="pagination-btn" 
							onclick={() => goToPage(1)} 
							disabled={currentPage === 1 || loading}
							title="First page"
						>
							⏮
						</button>
						<button 
							class="pagination-btn" 
							onclick={() => goToPage(currentPage - 1)} 
							disabled={currentPage === 1 || loading}
							title="Previous page"
						>
							◀
						</button>
						<span class="page-info">Page {currentPage} of {totalPages}</span>
						<button 
							class="pagination-btn" 
							onclick={() => goToPage(currentPage + 1)} 
							disabled={currentPage >= totalPages || loading}
							title="Next page"
						>
							▶
						</button>
						<button 
							class="pagination-btn" 
							onclick={() => goToPage(totalPages)} 
							disabled={currentPage >= totalPages || loading}
							title="Last page"
						>
							⏭
						</button>
					</div>
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
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
	}
	
	.back-link:hover {
		color: var(--color-text);
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
		background: var(--color-surface-elevated);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: bold;
		color: var(--color-text);
	}
	
	.guild-text h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	
	.guild-id {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-family: monospace;
	}
	
	.header-right {
		display: flex;
		gap: 0.5rem;
	}
	
	.refresh-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.875rem;
	}
	
	.refresh-btn:hover {
		background: var(--color-surface-elevated);
	}
	
	.refresh-btn.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-text-inverse);
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
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem;
		text-align: center;
		border-left: 3px solid var(--cat-color, var(--color-primary));
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
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	
	/* Filters */
	.filters-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
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
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	
	.filter-group select,
	.filter-group input {
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
		border-radius: 4px;
		font-size: 0.875rem;
	}
	
	.clear-btn {
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: 4px;
		cursor: pointer;
		white-space: nowrap;
	}
	
	.clear-btn:hover {
		color: var(--color-text);
		border-color: var(--color-text);
	}
	
	/* Results Info */
	.results-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border-radius: 8px;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	.loading-indicator {
		color: var(--color-primary);
	}
	
	/* Logs Table */
	.logs-table-container {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}
	
	.logs-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	
	.logs-table th {
		background: var(--color-surface);
		padding: 0.75rem 1rem;
		text-align: left;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		font-size: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}
	
	.logs-table td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border-light);
		vertical-align: top;
	}
	
	.logs-table tr:hover td {
		background: var(--color-surface-elevated);
	}
	
	.time-cell {
		white-space: nowrap;
		color: var(--color-text-muted);
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
		color: var(--color-text-muted);
		font-family: monospace;
	}
	
	.channel-name {
		color: var(--color-primary);
	}
	
	.na {
		color: var(--color-text-light);
	}
	
	.details-btn {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		cursor: pointer;
		text-decoration: none;
		text-align: center;
	}
	
	.details-btn:hover {
		background: var(--color-surface-hover);
	}
	
	.details-btn.secondary {
		background: transparent;
		color: var(--color-text-muted);
	}
	
	.details-btn.secondary:hover {
		color: var(--color-text);
		background: var(--color-surface-elevated);
	}
	
	.details-cell {
		white-space: nowrap;
	}
	
	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 3rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}
	
	.empty-state h3 {
		margin: 0 0 0.5rem;
	}
	
	.empty-state p {
		color: var(--color-text-muted);
		margin: 0.5rem 0;
	}
	
	.empty-state .hint {
		font-size: 0.875rem;
		font-style: italic;
	}
	
	/* Error Card */
	.error-card {
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
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
		background: var(--color-primary);
		color: var(--color-text-inverse);
		text-decoration: none;
		border-radius: 6px;
		font-weight: 500;
		margin-top: 1rem;
	}
	
	.btn:hover {
		background: var(--color-primary-hover);
	}

	.results-left {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	
	.results-right {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}
	
	.page-size-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.page-size-selector label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
	
	.page-size-selector select {
		padding: 0.35rem 0.5rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		font-size: 0.875rem;
		cursor: pointer;
	}
	
	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	.pagination-btn {
		padding: 0.35rem 0.65rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.875rem;
		transition: background-color 0.2s;
	}
	
	.pagination-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}
	
	.pagination-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	
	.page-info {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		padding: 0 0.5rem;
		min-width: 100px;
		text-align: center;
	}
	
	.bottom-pagination {
		display: flex;
		justify-content: center;
		padding: 1.5rem;
	}
	
	/* Sortable Table Headers */
	th.sortable {
		cursor: pointer;
		user-select: none;
		position: relative;
	}
	
	th.sortable:hover {
		background: var(--color-surface-elevated);
	}
	
	.sort-indicator {
		margin-left: 0.35rem;
		font-weight: bold;
	}
	
	.sort-hint {
		display: none;
		position: absolute;
		top: 100%;
		left: 0;
		background: var(--color-surface-elevated);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: normal;
		white-space: nowrap;
		z-index: 10;
		box-shadow: var(--shadow-md);
	}
	
	th.sortable:hover .sort-hint {
		display: block;
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
		
		.results-info {
			flex-direction: column;
			align-items: flex-start;
		}
		
		.results-right {
			flex-wrap: wrap;
		}
		
		.page-info {
			min-width: auto;
		}
	}
</style>
