<script>
	import { log } from '$lib/log.js';
	
	/**
	 * User Selector Component
	 * A searchable dropdown for selecting Discord users/members
	 * Supports both single and multi-select modes
	 * 
	 * Fetches users from the guild members API with search support
	 */
	
	// Special value for "Any User"
	const ANY_USER = 'ALL';
	
	let { 
		guildId = null,
		members: preloadedMembers = null, // Pre-loaded members to avoid multiple fetches
		value = $bindable(),
		name = 'user',
		required = false,
		multiple = true, // Enable multi-select by default
		placeholder = 'Search users...',
		showAnyOption = true // Show "Any" option at top
	} = $props();
	
	// Ensure value is never undefined internally
	$effect(() => {
		if (value === undefined) {
			value = '';
		}
	});
	
	let members = $state([]);
	let loading = $state(false);
	let error = $state(null);
	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);
	
	// Cache for selected members to preserve display info across searches
	let selectedMembersCache = $state({});
	
	let inputRef = $state(null);
	let dropdownRef = $state(null);
	let wrapperRef = $state(null);
	
	// Parse value to array for multi-select
	const selectedIds = $derived.by(() => {
		if (!value) return [];
		if (multiple) {
			return value.split(',').filter(id => id.trim());
		}
		return [value];
	});
	
	// Check if "Any" is selected
	const isAnySelected = $derived(selectedIds.includes(ANY_USER));
	
	// Track if we've fetched initial members
	let hasFetchedInitial = $state(false);
	
	// Use preloaded members if provided, otherwise fetch on open
	$effect(() => {
		if (preloadedMembers) {
			members = preloadedMembers;
		}
	});
	
	// Live search members when search query changes (with debounce)
	$effect(() => {
		if (!guildId || !isOpen) return;
		
		const query = searchQuery; // Capture current value
		
		if (query.length >= 1) {
			// Debounce search to avoid too many API calls
			const timeout = setTimeout(() => {
				searchMembers(query);
			}, 200);
			
			return () => clearTimeout(timeout);
		} else if (query.length === 0 && !hasFetchedInitial) {
			// When search is cleared or first opened, fetch initial members list
			fetchMembers();
		}
	});
	
	async function fetchMembers() {
		if (!guildId) return;
		
		loading = true;
		error = null;
		
		try {
			const response = await fetch(`/api/discord/guilds/${guildId}/members?limit=50`);
			
			if (!response.ok) {
				throw new Error('Failed to fetch members');
			}
			
			const data = await response.json();
			members = data.members || [];
			hasFetchedInitial = true;
		} catch (err) {
			log.error('Error fetching members:', err);
			error = err.message;
			members = [];
		} finally {
			loading = false;
		}
	}
	
	async function searchMembers(query) {
		if (!guildId || !query) return;
		
		loading = true;
		error = null;
		
		try {
			const response = await fetch(`/api/discord/guilds/${guildId}/members?query=${encodeURIComponent(query)}&limit=25`);
			
			if (!response.ok) {
				throw new Error('Failed to search members');
			}
			
			const data = await response.json();
			members = data.members || [];
		} catch (err) {
			log.error('Error searching members:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}
	
	// Get selected member info for display (uses cache to preserve info across searches)
	const selectedMemberInfo = $derived.by(() => {
		if (selectedIds.length === 0) return [];
		return selectedIds.map(id => {
			if (id === ANY_USER) return { id: ANY_USER, displayName: '✱ Any' };
			// Check cache first, then current members list
			const cached = selectedMembersCache[id];
			if (cached) {
				return cached;
			}
			const member = members.find(m => m.id === id);
			if (member) {
				return { 
					id: member.id, 
					displayName: member.displayName,
					isBot: member.isBot 
				};
			}
			// Show ID if member not loaded
			return { id, displayName: `User ${id.slice(-4)}` };
		});
	});
	
	function isSelected(userId) {
		return selectedIds.includes(userId);
	}
	
	function selectAny() {
		value = ANY_USER;
		searchQuery = '';
		// Clear cache when selecting Any
		selectedMembersCache = {};
	}
	
	function toggleMember(member) {
		if (multiple) {
			if (isSelected(member.id)) {
				// Remove from selection and cache
				const newIds = selectedIds.filter(id => id !== member.id);
				value = newIds.join(',');
				const newCache = { ...selectedMembersCache };
				delete newCache[member.id];
				selectedMembersCache = newCache;
			} else {
				// Add to selection and cache
				const newIds = selectedIds.filter(id => id !== ANY_USER);
				value = [...newIds, member.id].join(',');
				// Cache the member info
				selectedMembersCache = {
					...selectedMembersCache,
					[member.id]: {
						id: member.id,
						displayName: member.displayName,
						isBot: member.isBot
					}
				};
			}
			// Clear search after selection
			searchQuery = '';
		} else {
			// Single select - just set the value and close
			value = member.id;
			selectedMembersCache = {
				[member.id]: {
					id: member.id,
					displayName: member.displayName,
					isBot: member.isBot
				}
			};
			searchQuery = '';
			isOpen = false;
			highlightedIndex = -1;
		}
	}
	
	function removeMember(userId) {
		const newIds = selectedIds.filter(id => id !== userId);
		value = newIds.join(',');
	}
	
	function clearSelection() {
		value = '';
		searchQuery = '';
		inputRef?.focus();
	}
	
	function handleInputFocus() {
		isOpen = true;
		// The $effect will handle fetching members when isOpen becomes true
	}
	
	function handleInputBlur(e) {
		// Don't close if clicking inside the component
		// The relatedTarget is where focus is going
		const relatedTarget = e.relatedTarget;
		if (relatedTarget && (dropdownRef?.contains(relatedTarget) || wrapperRef?.contains(relatedTarget))) {
			return;
		}
		// Delay closing to allow click events on dropdown items
		setTimeout(() => {
			isOpen = false;
			highlightedIndex = -1;
		}, 150);
	}
	
	function handleKeydown(e) {
		const visibleMembers = members.filter(m => !isAnySelected || m.id !== ANY_USER);
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, visibleMembers.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && visibleMembers[highlightedIndex]) {
					toggleMember(visibleMembers[highlightedIndex]);
				}
				break;
			case 'Escape':
				isOpen = false;
				highlightedIndex = -1;
				break;
		}
	}
	
	// Close dropdown when clicking outside
	function handleClickOutside(e) {
		if (dropdownRef && !dropdownRef.contains(e.target) && !wrapperRef?.contains(e.target)) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="user-selector" class:multi={multiple} bind:this={wrapperRef}>
	<!-- Hidden input for form submission -->
	<input type="hidden" {name} bind:value {required} />
	
	<div class="selector-input-wrapper">
		{#if multiple && selectedIds.length > 0}
			<!-- Multi-select: show tags -->
			<div class="selected-tags">
				{#each selectedMemberInfo as member, i}
					<span class="user-tag" class:bot={member.isBot}>
						{#if member.isBot}🤖{/if}
						{member.displayName}
						{#if member.id !== ANY_USER}
							<button type="button" class="tag-remove" onclick={() => removeMember(member.id)}>×</button>
						{/if}
					</span>
				{/each}
				<input
					type="text"
					bind:this={inputRef}
					bind:value={searchQuery}
					onfocus={handleInputFocus}
					onblur={handleInputBlur}
					onkeydown={handleKeydown}
					placeholder={selectedIds.length > 0 ? '' : placeholder}
					class="search-input inline"
					autocomplete="off"
				/>
			</div>
		{:else if !multiple && value && !isOpen}
			<!-- Single select: show selected user -->
			<div class="selected-user">
				<span class="user-display">
					{selectedMemberInfo[0]?.isBot ? '🤖 ' : '👤 '}
					{selectedMemberInfo[0]?.displayName || value}
				</span>
				<button type="button" class="clear-btn" onclick={clearSelection} title="Clear selection">
					×
				</button>
			</div>
		{:else}
			<!-- Search input -->
			<input
				type="text"
				bind:this={inputRef}
				bind:value={searchQuery}
				onfocus={handleInputFocus}
				onblur={handleInputBlur}
				onkeydown={handleKeydown}
				{placeholder}
				class="search-input"
				autocomplete="off"
			/>
		{/if}
		
		{#if loading}
			<span class="loading-indicator">⏳</span>
		{/if}
	</div>
	
	{#if isOpen}
		<div class="dropdown" bind:this={dropdownRef}>
			{#if error}
				<div class="dropdown-error">
					<span>⚠️ {error}</span>
					<button type="button" class="retry-btn" onclick={fetchMembers}>Retry</button>
				</div>
			{:else if loading}
				<div class="dropdown-loading">
					<span>🔍 Searching...</span>
				</div>
			{:else if members.length === 0 && !showAnyOption}
				<div class="dropdown-empty">
					{#if searchQuery}
						No users match "{searchQuery}"
					{:else}
						Type to search for users...
					{/if}
				</div>
			{:else}
				{#if showAnyOption && multiple && !searchQuery}
					<!-- Any option -->
					<button
						type="button"
						class="user-option any-option"
						class:selected={isAnySelected}
						onclick={(e) => { e.stopPropagation(); selectAny(); }}
						onmousedown={(e) => e.preventDefault()}
					>
						<span class="checkbox">{isAnySelected ? '☑' : '☐'}</span>
						<span class="user-icon">✱</span>
						<span class="user-name">Any User</span>
					</button>
					<div class="dropdown-divider"></div>
				{/if}
				
				{#if members.length === 0 && showAnyOption}
					<div class="dropdown-hint">
						Type to search for specific users...
					</div>
				{:else}
					{#each members as member, index}
						<button
							type="button"
							class="user-option"
							class:selected={isSelected(member.id)}
							class:highlighted={highlightedIndex === index}
							onclick={(e) => { e.stopPropagation(); toggleMember(member); }}
							onmousedown={(e) => e.preventDefault()}
							onmouseenter={() => highlightedIndex = index}
						>
							{#if multiple}
								<span class="checkbox">{isSelected(member.id) ? '☑' : '☐'}</span>
							{/if}
							<img 
								src={member.avatar} 
								alt="" 
								class="user-avatar"
								onerror={(e) => e.target.style.display = 'none'}
							/>
							<span class="user-info">
								<span class="user-name">
									{#if member.isBot}🤖{/if}
									{member.displayName}
								</span>
								{#if member.username !== member.displayName}
									<span class="user-username">@{member.username}</span>
								{/if}
							</span>
						</button>
					{/each}
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.user-selector {
		position: relative;
		width: 100%;
	}
	
	.selector-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}
	
	.search-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 0.875rem;
		transition: border-color 0.2s;
	}
	
	.search-input.inline {
		flex: 1;
		min-width: 60px;
		border: none;
		background: transparent;
		padding: 0.25rem;
	}
	
	.search-input:focus {
		outline: none;
		border-color: var(--accent-color, #5865F2);
	}
	
	.search-input.inline:focus {
		border: none;
	}
	
	.search-input::placeholder {
		color: var(--text-muted, #72767d);
	}
	
	/* Multi-select tags */
	.selected-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		min-height: 42px;
		align-items: center;
		width: 100%;
	}
	
	.user-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: var(--accent-color-faded, rgba(88, 101, 242, 0.2));
		border-radius: 4px;
		font-size: 0.8125rem;
		color: var(--text-primary, #fff);
	}
	
	.user-tag.bot {
		background: var(--success-color-faded, rgba(67, 181, 129, 0.2));
	}
	
	.tag-remove {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		padding: 0 0.125rem;
		font-size: 1rem;
		line-height: 1;
	}
	
	.tag-remove:hover {
		color: var(--error-color, #ed4245);
	}
	
	/* Single select display */
	.selected-user {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
	}
	
	.user-display {
		color: var(--text-primary, #fff);
	}
	
	.clear-btn {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		padding: 0.25rem;
		font-size: 1.125rem;
		line-height: 1;
	}
	
	.clear-btn:hover {
		color: var(--error-color, #ed4245);
	}
	
	/* Loading indicator */
	.loading-indicator {
		position: absolute;
		right: 0.75rem;
		font-size: 0.875rem;
	}
	
	/* Dropdown */
	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 100;
		max-height: 300px;
		overflow-y: auto;
	}
	
	.dropdown-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		color: var(--error-color, #ed4245);
	}
	
	.retry-btn {
		padding: 0.25rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 4px;
		color: var(--text-primary, #fff);
		cursor: pointer;
		font-size: 0.75rem;
	}
	
	.dropdown-empty,
	.dropdown-hint,
	.dropdown-loading {
		padding: 0.75rem;
		color: var(--text-muted, #72767d);
		text-align: center;
		font-size: 0.875rem;
	}
	
	.dropdown-loading {
		color: var(--accent-color, #5865F2);
	}
	
	.dropdown-divider {
		height: 1px;
		background: var(--border-color, #40444b);
		margin: 0.25rem 0;
	}
	
	.user-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		color: var(--text-primary, #fff);
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
	}
	
	.user-option:hover,
	.user-option.highlighted {
		background: var(--bg-tertiary, #36393f);
	}
	
	.user-option.selected {
		background: var(--accent-color-faded, rgba(88, 101, 242, 0.15));
	}
	
	.user-option.any-option {
		color: var(--accent-color, #5865F2);
	}
	
	.checkbox {
		font-size: 0.875rem;
		opacity: 0.7;
	}
	
	.user-icon {
		font-size: 1rem;
	}
	
	.user-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	
	.user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	
	.user-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.user-username {
		font-size: 0.75rem;
		color: var(--text-muted, #72767d);
	}
</style>
