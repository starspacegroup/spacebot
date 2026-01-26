<script>
	let { guilds = [], selectedGuildId = null, basePath = '/admin' } = $props();
	let isOpen = $state(false);
	
	// Filter to only show servers where the bot is installed
	const availableGuilds = $derived(guilds.filter(g => !g.botNotIn));
	
	const selectedGuild = $derived(availableGuilds.find(g => g.id === selectedGuildId));
	
	function toggleDropdown() {
		isOpen = !isOpen;
	}
	
	function closeDropdown() {
		isOpen = false;
	}
	
	function selectGuild(guildId) {
		window.location.href = `${basePath}?guild=${guildId}`;
	}
	
	function handleKeydown(event) {
		if (event.key === 'Escape') {
			closeDropdown();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if availableGuilds.length > 0}
	<div class="server-selector" class:open={isOpen}>
		<button 
			class="selector-trigger"
			onclick={toggleDropdown}
			aria-expanded={isOpen}
			aria-haspopup="listbox"
			aria-label="Select server"
		>
			{#if selectedGuild}
				{#if selectedGuild.icon}
					<img 
						src="https://cdn.discordapp.com/icons/{selectedGuild.id}/{selectedGuild.icon}.png?size=32" 
						alt=""
						class="server-icon"
					/>
				{:else}
					<div class="server-icon-placeholder">
						{selectedGuild.name.charAt(0).toUpperCase()}
					</div>
				{/if}
				<span class="server-name">{selectedGuild.name}</span>
			{:else}
				<span class="server-name placeholder">Select server</span>
			{/if}
			<svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		
		{#if isOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="dropdown-backdrop" onclick={closeDropdown}></div>
			<ul class="dropdown-list" role="listbox">
				{#each availableGuilds as guild}
					<li>
						<button
							class="dropdown-item"
							class:selected={guild.id === selectedGuildId}
							role="option"
							aria-selected={guild.id === selectedGuildId}
							onclick={() => selectGuild(guild.id)}
						>
							{#if guild.icon}
								<img 
									src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=32" 
									alt=""
									class="item-icon"
								/>
							{:else}
								<div class="item-icon-placeholder">
									{guild.name.charAt(0).toUpperCase()}
								</div>
							{/if}
							<span class="item-name">{guild.name}</span>
							{#if guild.owner}
								<span class="badge owner">Owner</span>
							{/if}
						</button>
					</li>
				{/each}
				<li class="dropdown-divider"></li>
				<li>
					<a href="/admin/servers/add" class="dropdown-item add-server-btn" onclick={closeDropdown}>
						<svg class="add-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
							<path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
						<span class="item-name">Add Server...</span>
					</a>
				</li>
			</ul>
		{/if}
	</div>
{:else}
	<a href="/admin/servers/add" class="add-server-link">
		<svg class="add-icon-small" width="16" height="16" viewBox="0 0 24 24" fill="none">
			<path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
		Add Server...
	</a>
{/if}

<style>
	.server-selector {
		position: relative;
	}
	
	.selector-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
		transition: border-color var(--transition-fast), background var(--transition-fast);
		max-width: 180px;
	}
	
	.selector-trigger:hover {
		border-color: var(--color-primary);
		background: var(--color-surface-hover);
	}
	
	.selector-trigger:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.25);
	}
	
	.server-icon {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	
	.server-icon-placeholder {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	
	.server-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	
	.server-name.placeholder {
		color: var(--color-text-muted);
	}
	
	.chevron {
		flex-shrink: 0;
		transition: transform var(--transition-fast);
		color: var(--color-text-muted);
	}
	
	.server-selector.open .chevron {
		transform: rotate(180deg);
	}
	
	.dropdown-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}
	
	.dropdown-list {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 100;
		min-width: 220px;
		max-width: 280px;
		max-height: 320px;
		overflow-y: auto;
		margin: 0;
		padding: 0.375rem;
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}
	
	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition: background var(--transition-fast);
	}
	
	.dropdown-item:hover {
		background: var(--color-surface-hover);
	}
	
	.dropdown-item.selected {
		background: var(--color-primary-soft);
	}
	
	.dropdown-item.add-server-btn {
		color: var(--color-primary);
		text-decoration: none;
	}
	
	.dropdown-item.add-server-btn:hover {
		background: var(--color-primary-soft);
	}
	
	.dropdown-divider {
		height: 1px;
		margin: 0.375rem 0;
		background: var(--color-border);
	}
	
	.add-icon {
		flex-shrink: 0;
	}
	
	.add-server-link {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-primary);
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
		transition: background var(--transition-fast);
	}
	
	.add-server-link:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.add-icon-small {
		flex-shrink: 0;
	}
	
	.item-icon {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	
	.item-icon-placeholder {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	
	.item-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.badge {
		flex-shrink: 0;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	
	.badge.owner {
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}
	
	/* Mobile responsive */
	@media (max-width: 480px) {
		.selector-trigger {
			max-width: 140px;
			padding: 0.25rem 0.5rem;
		}
		
		.server-name {
			display: none;
		}
		
		.selector-trigger:has(.server-icon),
		.selector-trigger:has(.server-icon-placeholder) {
			max-width: none;
		}
		
		.dropdown-list {
			position: fixed;
			top: auto;
			bottom: 0;
			left: 0;
			right: 0;
			max-width: none;
			max-height: 60vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		}
		
		.dropdown-item {
			padding: 0.75rem;
		}
	}
</style>
