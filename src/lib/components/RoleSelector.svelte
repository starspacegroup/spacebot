<script>
	/**
	 * Role Selector Component
	 * A searchable dropdown for selecting Discord roles
	 * Supports both single and multi-select modes
	 * 
	 * Can either fetch roles itself (if guildId provided) or use pre-loaded roles
	 */
	
	// Special value for "Any Role"
	const ANY_ROLE = 'ALL';
	
	let { 
		guildId = null,
		roles: preloadedRoles = null, // Pre-loaded roles to avoid multiple fetches
		value = $bindable(''),
		name = 'role',
		required = false,
		multiple = false, // Enable multi-select
		placeholder = 'Search roles...',
		showAnyOption = false // Show "Any" option at top (multi-select only)
	} = $props();
	
	let roles = $state([]);
	let loading = $state(false);
	let error = $state(null);
	let searchQuery = $state('');
	let isOpen = $state(false);
	let highlightedIndex = $state(-1);
	
	let inputRef = $state(null);
	let dropdownRef = $state(null);
	
	// Parse value to array for multi-select
	const selectedIds = $derived.by(() => {
		if (!value) return [];
		if (multiple) {
			return value.split(',').filter(id => id.trim());
		}
		return [value];
	});
	
	// Check if "Any" is selected
	const isAnySelected = $derived(selectedIds.includes(ANY_ROLE));
	
	// Use preloaded roles if provided, otherwise fetch
	$effect(() => {
		if (preloadedRoles) {
			roles = preloadedRoles;
		} else if (guildId) {
			fetchRoles();
		} else {
			roles = [];
		}
	});
	
	async function fetchRoles() {
		loading = true;
		error = null;
		
		try {
			const response = await fetch(`/api/discord/guilds/${guildId}/roles`);
			
			if (!response.ok) {
				throw new Error('Failed to fetch roles');
			}
			
			const data = await response.json();
			roles = data.roles || [];
		} catch (err) {
			console.error('Error fetching roles:', err);
			error = err.message;
			roles = [];
		} finally {
			loading = false;
		}
	}
	
	// Filter roles by search query
	const filteredRoles = $derived.by(() => {
		if (!searchQuery.trim()) return roles;
		
		const query = searchQuery.toLowerCase();
		return roles.filter(role => role.name.toLowerCase().includes(query));
	});
	
	// Get selected role names for display
	const selectedRoleNames = $derived.by(() => {
		if (selectedIds.length === 0) return [];
		return selectedIds.map(id => {
			if (id === ANY_ROLE) return '✱ Any';
			const role = roles.find(r => r.id === id);
			return role ? `@${role.name}` : id;
		});
	});
	
	// Get role color for display
	function getRoleColor(role) {
		return role.color || 'var(--text-muted, #72767d)';
	}
	
	function isSelected(roleId) {
		return selectedIds.includes(roleId);
	}
	
	function selectAny() {
		value = ANY_ROLE;
		searchQuery = '';
	}
	
	function toggleRole(role) {
		if (multiple) {
			if (isSelected(role.id)) {
				// Remove from selection
				const newIds = selectedIds.filter(id => id !== role.id);
				value = newIds.join(',');
			} else {
				// Add to selection - remove ANY if present since we're picking specific roles
				const newIds = selectedIds.filter(id => id !== ANY_ROLE);
				value = [...newIds, role.id].join(',');
			}
		} else {
			// Single select - just set the value and close
			value = role.id;
			searchQuery = '';
			isOpen = false;
			highlightedIndex = -1;
		}
	}
	
	function removeRole(roleId) {
		const newIds = selectedIds.filter(id => id !== roleId);
		value = newIds.join(',');
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
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, filteredRoles.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && filteredRoles[highlightedIndex]) {
					toggleRole(filteredRoles[highlightedIndex]);
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

<div class="role-selector" class:multi={multiple}>
	<!-- Hidden input for form submission -->
	<input type="hidden" {name} bind:value {required} />
	
	<div class="selector-input-wrapper">
		{#if multiple && selectedIds.length > 0}
			<!-- Multi-select: show tags -->
			<div class="selected-tags">
				{#each selectedRoleNames as roleName, i}
					<span class="role-tag">
						{roleName}
						<button type="button" class="tag-remove" onclick={() => removeRole(selectedIds[i])}>×</button>
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
			<!-- Single select: show selected role -->
			<div class="selected-role">
				<span class="role-display">{selectedRoleNames[0] || value}</span>
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
					<button type="button" class="retry-btn" onclick={fetchRoles}>Retry</button>
				</div>
			{:else if filteredRoles.length === 0 && !showAnyOption}
				<div class="dropdown-empty">
					{#if roles.length === 0}
						No roles available
					{:else}
						No roles match "{searchQuery}"
					{/if}
				</div>
			{:else}
				{#if showAnyOption && multiple && !searchQuery}
					<!-- Any option -->
					<button
						type="button"
						class="role-option any-option"
						class:selected={isAnySelected}
						onclick={selectAny}
					>
						<span class="checkbox">{isAnySelected ? '☑' : '☐'}</span>
						<span class="role-icon">✱</span>
						<span class="role-name">Any</span>
					</button>
					<div class="dropdown-divider"></div>
				{/if}
				
				{#each filteredRoles as role, index}
					<button
						type="button"
						class="role-option"
						class:selected={isSelected(role.id)}
						class:highlighted={highlightedIndex === index}
						onclick={() => toggleRole(role)}
						onmouseenter={() => highlightedIndex = index}
					>
						{#if multiple}
							<span class="checkbox">{isSelected(role.id) ? '☑' : '☐'}</span>
						{/if}
						<span class="role-color" style="background-color: {getRoleColor(role)}"></span>
						<span class="role-name">@{role.name}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.role-selector {
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
		width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		min-height: 42px;
		align-items: center;
	}
	
	.selected-tags:focus-within {
		border-color: var(--accent-color, #5865F2);
	}
	
	.role-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: var(--accent-color, #5865F2);
		color: white;
		border-radius: 4px;
		font-size: 0.8rem;
		font-weight: 500;
	}
	
	.tag-remove {
		background: none;
		border: none;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
		margin-left: 0.125rem;
	}
	
	.tag-remove:hover {
		color: white;
	}
	
	.selected-role {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--bg-tertiary, #36393f);
		border: 1px solid var(--border-color, #40444b);
		border-radius: 8px;
		font-size: 0.875rem;
		cursor: pointer;
	}
	
	.selected-role:hover {
		border-color: var(--accent-color, #5865F2);
	}
	
	.role-display {
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
	
	.role-option {
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
	
	.role-option:hover,
	.role-option.highlighted {
		background: var(--bg-tertiary, #36393f);
	}
	
	.role-option.selected {
		background: var(--accent-color, #5865F2);
		color: white;
	}
	
	.role-option.selected:hover,
	.role-option.selected.highlighted {
		background: var(--accent-hover, #4752C4);
	}
	
	.checkbox {
		font-size: 1rem;
		min-width: 1.25rem;
	}
	
	.role-icon {
		font-size: 1rem;
		color: var(--accent-color, #5865F2);
		min-width: 1.25rem;
		text-align: center;
	}
	
	.role-option.selected .role-icon {
		color: inherit;
	}
	
	.role-color {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	
	.role-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.dropdown-divider {
		height: 1px;
		background: var(--border-color, #40444b);
		margin: 0.25rem 0;
	}
	
	.any-option {
		font-weight: 500;
	}
	
	.any-option .role-icon {
		color: var(--accent-color, #5865F2);
	}
	
	.any-option.selected .role-icon {
		color: inherit;
	}
</style>
