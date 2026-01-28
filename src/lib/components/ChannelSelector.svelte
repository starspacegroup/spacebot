<script>
	/**
	 * Channel Selector Component
	 * A searchable dropdown for selecting Discord channels
	 */
	
	let { 
		guildId, 
		value = $bindable(''),
		name = 'channel',
		required = false,
		placeholder = 'Search channels...',
		typeFilter = 'sendable' // 'sendable', 'text', 'voice', 'text,voice', etc.
	} = $props();
	
	let channels = $state([]);
	let loading = $state(false);
	let error = $state(null);
	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);
	
	let inputRef = $state(null);
	let dropdownRef = $state(null);
	
	// Fetch channels when guildId changes
	$effect(() => {
		if (guildId) {
			fetchChannels();
		} else {
			channels = [];
		}
	});
	
	async function fetchChannels() {
		loading = true;
		error = null;
		
		try {
			const params = new URLSearchParams();
			if (typeFilter) params.set('type', typeFilter);
			
			const response = await fetch(`/api/discord/guilds/${guildId}/channels?${params}`);
			
			if (!response.ok) {
				throw new Error('Failed to fetch channels');
			}
			
			const data = await response.json();
			channels = data.channels || [];
		} catch (err) {
			console.error('Error fetching channels:', err);
			error = err.message;
			channels = [];
		} finally {
			loading = false;
		}
	}
	
	// Flatten channels for searching
	const flatChannels = $derived(() => {
		const flat = [];
		for (const group of channels) {
			for (const ch of group.channels) {
				flat.push({
					...ch,
					categoryName: group.categoryName
				});
			}
		}
		return flat;
	});
	
	// Filter channels by search query
	const filteredChannels = $derived(() => {
		if (!searchQuery.trim()) return channels;
		
		const query = searchQuery.toLowerCase();
		
		return channels
			.map(group => ({
				...group,
				channels: group.channels.filter(ch => 
					ch.name.toLowerCase().includes(query) ||
					group.categoryName.toLowerCase().includes(query)
				)
			}))
			.filter(group => group.channels.length > 0);
	});
	
	// Get selected channel name for display
	const selectedChannelName = $derived(() => {
		if (!value) return '';
		const ch = flatChannels().find(c => c.id === value);
		return ch ? `#${ch.name}` : value;
	});
	
	// Channel type icons
	function getChannelIcon(type) {
		switch (type) {
			case 'text': return '#';
			case 'voice': return '🔊';
			case 'announcement': return '📢';
			case 'forum': return '💬';
			case 'stage': return '🎭';
			default: return '#';
		}
	}
	
	function selectChannel(channel) {
		value = channel.id;
		searchQuery = '';
		isOpen = false;
		highlightedIndex = -1;
	}
	
	function clearSelection() {
		value = '';
		searchQuery = '';
		inputRef?.focus();
	}
	
	function handleInputFocus() {
		isOpen = true;
	}
	
	function handleInputBlur(e) {
		// Delay closing to allow click events on dropdown items
		setTimeout(() => {
			if (!dropdownRef?.contains(document.activeElement)) {
				isOpen = false;
				highlightedIndex = -1;
			}
		}, 150);
	}
	
	function handleKeydown(e) {
		const allChannels = filteredChannels().flatMap(g => g.channels);
		
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, allChannels.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && allChannels[highlightedIndex]) {
					selectChannel(allChannels[highlightedIndex]);
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
		if (dropdownRef && !dropdownRef.contains(e.target) && !inputRef?.contains(e.target)) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="channel-selector">
	<!-- Hidden input for form submission -->
	<input type="hidden" {name} bind:value {required} />
	
	<div class="selector-input-wrapper">
		{#if value && !isOpen}
			<!-- Show selected channel -->
			<div class="selected-channel">
				<span class="channel-display">{selectedChannelName()}</span>
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
	
	{#if isOpen && !loading}
		<div class="dropdown" bind:this={dropdownRef}>
			{#if error}
				<div class="dropdown-error">
					<span>⚠️ {error}</span>
					<button type="button" class="retry-btn" onclick={fetchChannels}>Retry</button>
				</div>
			{:else if filteredChannels().length === 0}
				<div class="dropdown-empty">
					{#if channels.length === 0}
						No channels available
					{:else}
						No channels match "{searchQuery}"
					{/if}
				</div>
			{:else}
				{@const allChannels = filteredChannels().flatMap(g => g.channels)}
				{#each filteredChannels() as group}
					<div class="channel-group">
						<div class="group-header">{group.categoryName}</div>
						{#each group.channels as channel}
							{@const globalIndex = allChannels.indexOf(channel)}
							<button
								type="button"
								class="channel-option {value === channel.id ? 'selected' : ''} {highlightedIndex === globalIndex ? 'highlighted' : ''}"
								onclick={() => selectChannel(channel)}
								onmouseenter={() => highlightedIndex = globalIndex}
							>
								<span class="channel-icon">{getChannelIcon(channel.type)}</span>
								<span class="channel-name">{channel.name}</span>
							</button>
						{/each}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.channel-selector {
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
	
	.search-input:focus {
		outline: none;
		border-color: var(--accent-color, #5865F2);
	}
	
	.search-input::placeholder {
		color: var(--text-muted, #72767d);
	}
	
	.selected-channel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		color: var(--text-primary, #fff);
		font-size: 0.875rem;
		cursor: pointer;
	}
	
	.selected-channel:hover {
		border-color: var(--accent-color, #5865F2);
	}
	
	.channel-display {
		color: var(--accent-color, #5865F2);
		font-weight: 500;
	}
	
	.clear-btn {
		background: none;
		border: none;
		color: var(--text-muted, #72767d);
		cursor: pointer;
		font-size: 1.25rem;
		padding: 0 0.25rem;
		line-height: 1;
	}
	
	.clear-btn:hover {
		color: var(--text-primary, #fff);
	}
	
	.loading-indicator {
		position: absolute;
		right: 0.75rem;
		animation: spin 1s linear infinite;
	}
	
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	
	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: var(--bg-secondary, #2f3136);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		max-height: 300px;
		overflow-y: auto;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	
	.dropdown-error,
	.dropdown-empty {
		padding: 1rem;
		text-align: center;
		color: var(--text-muted, #72767d);
	}
	
	.dropdown-error {
		color: #ED4245;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
	}
	
	.retry-btn {
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 4px;
		color: var(--text-primary, #fff);
		padding: 0.25rem 0.75rem;
		cursor: pointer;
		font-size: 0.75rem;
	}
	
	.retry-btn:hover {
		background: var(--bg-tertiary, #40444b);
	}
	
	.channel-group {
		padding: 0.25rem 0;
	}
	
	.channel-group:not(:last-child) {
		border-bottom: 1px solid var(--border-color, #40444b);
	}
	
	.group-header {
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--text-muted, #72767d);
		letter-spacing: 0.02em;
	}
	
	.channel-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		color: var(--text-primary, #dcddde);
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
		transition: background 0.1s;
	}
	
	.channel-option:hover,
	.channel-option.highlighted {
		background: var(--bg-tertiary, #36393f);
	}
	
	.channel-option.selected {
		background: var(--accent-color, #5865F2);
		color: white;
	}
	
	.channel-option.selected:hover,
	.channel-option.selected.highlighted {
		background: var(--accent-hover, #4752C4);
	}
	
	.channel-icon {
		font-size: 1rem;
		color: var(--text-muted, #72767d);
		min-width: 1.25rem;
		text-align: center;
	}
	
	.channel-option.selected .channel-icon {
		color: inherit;
	}
	
	.channel-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
