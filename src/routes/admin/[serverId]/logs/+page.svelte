<script>
	import { onMount } from 'svelte';
	import { log } from '$lib/log.js';
	import { formatDate as tzFormatDate, getTimezoneAbbreviation } from '$lib/timezone.js';
	
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
		if (!append) {
			loading = true;
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
			
			// Add timeout to prevent hanging forever
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 15000);
			
			let response;
			try {
				response = await fetch(url, { signal: controller.signal });
			} finally {
				clearTimeout(timeoutId);
			}
			
			const result = await response.json();
			log.debug('[DEBUG] API response:', result);
			
			// Check for error in response
			if (result.error) {
				throw new Error(result.error);
			}
			
			if (!response.ok) {
				throw new Error('Failed to fetch logs');
			}
			
			if (append) {
				logs = [...logs, ...result.logs || []];
			} else {
				logs = result.logs || [];
				categories = result.categories || {};
				eventTypes = result.eventTypes || {};
				if (result.stats) {
					stats = result.stats;
				}
			}
			
			total = result.total || 0;
			hasMore = result.hasMore || false;
			error = null;
		} catch (e) {
			log.error('[Logs] Fetch error:', e);
			if (e.name === 'AbortError') {
				error = 'Request timed out - the server may be slow or unavailable';
			} else {
				error = e.message || 'Unknown error occurred';
			}
			// Still load category/event metadata even on error
			if (!append) {
				logs = [];
				total = 0;
			}
		} finally {
			loading = false;
		}
	}
	
	function loadMore() {
		offset += limit;
		fetchLogs(true);
	}
	
	// Pagination computed values
	let totalPages = $derived(Math.ceil(Number(total) / Number(limit)) || 1);
	
	function goToPage(page) {
		if (page < 1 || page > totalPages) return;
		currentPage = page;
		offset = (page - 1) * limit;
		fetchLogs();
	}
	
	function changePageSize(newSize) {
		limit = Number(newSize);
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
		offset = 0;
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
	
	// Toggle category filter when clicking stat cards
	function toggleCategoryFilter(category) {
		if (selectedCategory === category) {
			// Deselect if already selected
			selectedCategory = '';
		} else {
			selectedCategory = category;
		}
		selectedEventType = ''; // Reset event type when category changes
		currentPage = 1;
		offset = 0;
		fetchLogs();
	}
	
	function formatDate(dateString) {
		return tzFormatDate(dateString, data.timezone);
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
			<a href="/admin/{data.serverId}" class="back-link">← Back to Admin</a>
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
				<button 
					class="stat-card stat-card-total"
					class:active={selectedCategory === ''}
					onclick={() => { selectedCategory = ''; selectedEventType = ''; currentPage = 1; offset = 0; fetchLogs(); }}
					type="button"
				>
					<span class="stat-value">{stats.totalEvents.toLocaleString()}</span>
					<span class="stat-label">Total Events</span>
				</button>
				{#each Object.entries(stats.byCategory || {}) as [cat, count]}
					<button 
						class="stat-card" 
						class:active={selectedCategory === cat}
						style="--cat-color: {getEventColor(cat)}"
						onclick={() => toggleCategoryFilter(cat)}
						type="button"
						title="Click to filter by {getCategoryName(cat)}"
					>
						<span class="stat-icon">{getEventIcon(cat)}</span>
						<span class="stat-value">{count.toLocaleString()}</span>
						<span class="stat-label">{getCategoryName(cat)}</span>
					</button>
				{/each}
			</div>
		{/if}
		
		<!-- Filters Section -->
		<details class="filters-section" open>
			<summary class="filters-header">
				<span class="filters-title">🔍 Filters</span>
				{#if selectedCategory || selectedEventType || searchQuery || startDate || endDate}
					<span class="filter-badge">Active</span>
				{/if}
				<span class="filters-toggle">▼</span>
			</summary>
			<div class="filters-content">
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
					
					<div class="filter-group filter-group-search">
						<label for="search">Search</label>
						<div class="search-input-wrapper">
							<input 
								id="search" 
								type="text" 
								placeholder="Search users, channels..." 
								bind:value={searchQuery}
								onkeydown={(e) => e.key === 'Enter' && applyFilters()}
							/>
							<button class="search-btn" onclick={applyFilters} type="button">Go</button>
						</div>
					</div>
				</div>
				
				<div class="filters-row filters-row-secondary">
					<div class="filter-group filter-group-date">
						<label for="startDate">From</label>
						<input 
							id="startDate" 
							type="datetime-local" 
							bind:value={startDate}
							onchange={applyFilters}
						/>
					</div>
					
					<div class="filter-group filter-group-date">
						<label for="endDate">To</label>
						<input 
							id="endDate" 
							type="datetime-local" 
							bind:value={endDate}
							onchange={applyFilters}
						/>
					</div>
					
					<button class="clear-btn" onclick={clearFilters} type="button">
						✕ Clear All
					</button>
				</div>
			</div>
		</details>
		
		<!-- Results Info & Pagination Controls -->
		<div class="results-info">
			<div class="results-left">
				<span class="results-count">
					<strong>{offset + 1}-{Math.min(offset + logs.length, total)}</strong> of <strong>{total.toLocaleString()}</strong> events
				</span>
				{#if loading}
					<span class="loading-indicator">⟳ Loading...</span>
				{/if}
			</div>
			<div class="results-right">
				<div class="page-size-selector">
					<label for="pageSize">Show:</label>
					<select id="pageSize" value={limit} onchange={(e) => changePageSize(parseInt(e.target.value))}>
						{#each pageSizeOptions as size}
							<option value={size} selected={size === limit}>{size}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>
		
		<!-- Pagination Controls -->
		{#if total > limit}
			<div class="pagination-bar">
				<button 
					type="button"
					class="pagination-btn" 
					onclick={() => goToPage(1)} 
					disabled={currentPage === 1 || loading}
					title="First page"
				>
					<span class="pagination-btn-icon">⏮</span>
					<span class="pagination-btn-text">First</span>
				</button>
				<button 
					type="button"
					class="pagination-btn" 
					onclick={() => goToPage(currentPage - 1)} 
					disabled={currentPage === 1 || loading}
					title="Previous page"
				>
					<span class="pagination-btn-icon">◀</span>
					<span class="pagination-btn-text">Prev</span>
				</button>
				
				<div class="page-indicator">
					<span class="page-current">{currentPage}</span>
					<span class="page-separator">/</span>
					<span class="page-total">{totalPages}</span>
				</div>
				
				<button 
					type="button"
					class="pagination-btn" 
					onclick={() => goToPage(currentPage + 1)} 
					disabled={currentPage >= totalPages || loading}
					title="Next page"
				>
					<span class="pagination-btn-text">Next</span>
					<span class="pagination-btn-icon">▶</span>
				</button>
				<button 
					type="button"
					class="pagination-btn" 
					onclick={() => goToPage(totalPages)} 
					disabled={currentPage >= totalPages || loading}
					title="Last page"
				>
					<span class="pagination-btn-text">Last</span>
					<span class="pagination-btn-icon">⏭</span>
				</button>
			</div>
		{/if}
		
		<!-- Logs Table -->
		{#if loading && logs.length === 0}
			<div class="loading-state">
				<div class="loading-spinner"></div>
				<p>Loading event logs...</p>
			</div>
		{:else if error}
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
								Time <span class="tz-label">({getTimezoneAbbreviation(data.timezone)})</span>
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
					<div class="pagination-bar">
						<button 
							type="button"
							class="pagination-btn" 
							onclick={() => goToPage(1)} 
							disabled={currentPage === 1 || loading}
							title="First page"
						>
							<span class="pagination-btn-icon">⏮</span>
							<span class="pagination-btn-text">First</span>
						</button>
						<button 
							type="button"
							class="pagination-btn" 
							onclick={() => goToPage(currentPage - 1)} 
							disabled={currentPage === 1 || loading}
							title="Previous page"
						>
							<span class="pagination-btn-icon">◀</span>
							<span class="pagination-btn-text">Prev</span>
						</button>
						
						<div class="page-indicator">
							<span class="page-current">{currentPage}</span>
							<span class="page-separator">/</span>
							<span class="page-total">{totalPages}</span>
						</div>
						
						<button 
							type="button"
							class="pagination-btn" 
							onclick={() => goToPage(currentPage + 1)} 
							disabled={currentPage >= totalPages || loading}
							title="Next page"
						>
							<span class="pagination-btn-text">Next</span>
							<span class="pagination-btn-icon">▶</span>
						</button>
						<button 
							type="button"
							class="pagination-btn" 
							onclick={() => goToPage(totalPages)} 
							disabled={currentPage >= totalPages || loading}
							title="Last page"
						>
							<span class="pagination-btn-text">Last</span>
							<span class="pagination-btn-icon">⏭</span>
						</button>
					</div>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.logs-container {
		width: 100%;
		margin: 0 auto;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.logs-container {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.logs-container {
			padding: 2rem 3rem;
		}
	}
	
	@media (min-width: 1536px) {
		.logs-container {
			padding: 2rem 4rem;
		}
	}
	
	.logs-header {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.logs-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			margin-bottom: 2rem;
		}
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
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	
	@media (min-width: 640px) {
		.guild-icon, .guild-icon-placeholder {
			width: 64px;
			height: 64px;
		}
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
		font-size: 1.25rem;
	}
	
	@media (min-width: 640px) {
		.guild-text h1 {
			font-size: 1.5rem;
		}
	}
	
	.guild-id {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-family: monospace;
	}
	
	.header-right {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	
	.refresh-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}
	
	.refresh-btn:hover {
		background: var(--color-surface-elevated);
	}
	
	.refresh-btn.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
		font-weight: 600;
	}
	
	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	/* Stats Grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-bottom: 2rem;
	}
	
	@media (min-width: 640px) {
		.stats-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	
	@media (min-width: 900px) {
		.stats-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	
	@media (min-width: 1200px) {
		.stats-grid {
			grid-template-columns: repeat(5, 1fr);
		}
	}
	
	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem 0.75rem;
		text-align: center;
		border-left: 3px solid var(--cat-color, var(--color-primary));
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
		color: inherit;
	}
	
	.stat-card:hover {
		background: var(--color-surface-elevated);
		border-color: var(--cat-color, var(--color-primary));
		transform: translateY(-2px);
	}
	
	.stat-card.active {
		background: color-mix(in srgb, var(--cat-color, var(--color-primary)) 15%, var(--color-surface));
		border-color: var(--cat-color, var(--color-primary));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--cat-color, var(--color-primary)) 30%, transparent);
	}
	
	.stat-card-total {
		--cat-color: var(--color-primary);
	}
	
	@media (min-width: 640px) {
		.stat-card {
			padding: 1.25rem 1rem;
		}
	}
	
	.stat-icon {
		font-size: 1.25rem;
		display: block;
		margin-bottom: 0.25rem;
	}
	
	@media (min-width: 640px) {
		.stat-icon {
			font-size: 1.5rem;
		}
	}
	
	.stat-value {
		font-size: 1.25rem;
		font-weight: bold;
		display: block;
	}
	
	@media (min-width: 640px) {
		.stat-value {
			font-size: 1.5rem;
		}
	}
	
	.stat-label {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		line-height: 1.2;
	}
	
	@media (min-width: 640px) {
		.stat-label {
			font-size: 0.75rem;
		}
	}
	
	/* Filters */
	.filters-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		margin-bottom: 1rem;
		overflow: hidden;
	}
	
	.filters-section[open] .filters-toggle {
		transform: rotate(180deg);
	}
	
	.filters-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		cursor: pointer;
		user-select: none;
		list-style: none;
		background: var(--color-surface);
	}
	
	.filters-header::-webkit-details-marker {
		display: none;
	}
	
	.filters-header:hover {
		background: var(--color-surface-elevated);
	}
	
	.filters-title {
		font-weight: 600;
		font-size: 0.875rem;
	}
	
	.filter-badge {
		background: var(--color-primary);
		color: var(--color-text-inverse);
		font-size: 0.65rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
	}
	
	.filters-toggle {
		margin-left: auto;
		transition: transform 0.2s ease;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	
	.filters-content {
		padding: 1rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	
	.filters-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	
	@media (min-width: 480px) {
		.filters-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	@media (min-width: 768px) {
		.filters-row {
			grid-template-columns: repeat(3, 1fr);
			gap: 1rem;
		}
	}
	
	.filters-row-secondary {
		align-items: flex-end;
	}
	
	@media (min-width: 768px) {
		.filters-row-secondary {
			grid-template-columns: 1fr 1fr auto;
		}
	}
	
	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	
	.filter-group-search {
		grid-column: 1 / -1;
	}
	
	@media (min-width: 768px) {
		.filter-group-search {
			grid-column: auto;
		}
	}
	
	.filter-group label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		font-weight: 500;
	}
	
	.filter-group select,
	.filter-group input {
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
		border-radius: 6px;
		font-size: 0.875rem;
		width: 100%;
	}
	
	.filter-group select:focus,
	.filter-group input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}
	
	.search-input-wrapper {
		display: flex;
		gap: 0.5rem;
	}
	
	.search-input-wrapper input {
		flex: 1;
	}
	
	.search-btn {
		padding: 0.6rem 1rem;
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	
	.search-btn:hover {
		background: var(--color-primary-hover);
	}
	
	.clear-btn {
		padding: 0.6rem 1rem;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
		font-size: 0.875rem;
		transition: all 0.2s;
	}
	
	.clear-btn:hover {
		color: var(--color-danger);
		border-color: var(--color-danger);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
	}
	
	/* Results Info */
	.results-info {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border-radius: 8px;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	@media (min-width: 480px) {
		.results-info {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
	}
	
	.results-count strong {
		color: var(--color-text);
	}
	
	.loading-indicator {
		color: var(--color-primary);
		animation: pulse 1s ease-in-out infinite;
	}
	
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
	
	/* Pagination Bar */
	.pagination-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--color-surface);
		border-radius: 8px;
		flex-wrap: wrap;
	}
	
	@media (min-width: 480px) {
		.pagination-bar {
			gap: 0.5rem;
		}
	}
	
	.page-indicator {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.75rem;
		font-size: 0.875rem;
	}
	
	.page-current {
		font-weight: bold;
		color: var(--color-primary);
	}
	
	.page-separator {
		color: var(--color-text-muted);
	}
	
	.page-total {
		color: var(--color-text-muted);
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
	
	.pagination-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.65rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
		transition: all 0.2s;
	}
	
	.pagination-btn:hover:not(:disabled) {
		background: var(--color-primary);
		color: var(--color-text-inverse);
		border-color: var(--color-primary);
	}
	
	.pagination-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	
	.pagination-btn-text {
		display: none;
	}
	
	@media (min-width: 480px) {
		.pagination-btn-text {
			display: inline;
		}
		
		.pagination-btn {
			padding: 0.5rem 0.85rem;
		}
	}
	
	.bottom-pagination {
		display: flex;
		justify-content: center;
		padding: 1rem;
	}
	
	@media (min-width: 640px) {
		.bottom-pagination {
			padding: 1.5rem;
		}
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
	
	.tz-label {
		font-size: 0.75rem;
		font-weight: normal;
		opacity: 0.6;
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
	
	/* Table Mobile Styles */
	@media (max-width: 768px) {
		.logs-table th:nth-child(4),
		.logs-table td:nth-child(4),
		.logs-table th:nth-child(5),
		.logs-table td:nth-child(5) {
			display: none;
		}
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
</style>
