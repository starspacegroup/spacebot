<script>
	let { user } = $props();
	let isOpen = $state(false);
	
	/**
	 * Get Discord avatar URL
	 * @param {string} userId
	 * @param {string|null} avatar
	 * @param {string} discriminator
	 */
	function getAvatarUrl(userId, avatar, discriminator = '0') {
		if (avatar) {
			const ext = avatar.startsWith('a_') ? 'gif' : 'png';
			return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=64`;
		}
		// Default avatar based on user ID or discriminator
		const index = discriminator === '0' 
			? (BigInt(userId) >> 22n) % 6n
			: parseInt(discriminator) % 5;
		return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
	}
	
	function toggleMenu() {
		isOpen = !isOpen;
	}
	
	function closeMenu() {
		isOpen = false;
	}
	
	function handleKeydown(event) {
		if (event.key === 'Escape') {
			closeMenu();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="user-menu" class:open={isOpen}>
	<button 
		class="user-button" 
		onclick={toggleMenu}
		aria-expanded={isOpen}
		aria-haspopup="true"
	>
		<img 
			src={getAvatarUrl(user.id, user.avatar, user.discriminator)} 
			alt="{user.username}'s avatar"
			class="user-avatar"
		/>
		<span class="user-name">{user.username}</span>
		<svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
			<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>
	
	{#if isOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="menu-backdrop" onclick={closeMenu}></div>
		<div class="dropdown" role="menu">
			<div class="dropdown-header">
				<img 
					src={getAvatarUrl(user.id, user.avatar, user.discriminator)} 
					alt="{user.username}'s avatar"
					class="dropdown-avatar"
				/>
				<div class="dropdown-user-info">
					<span class="dropdown-username">{user.username}</span>
					{#if user.globalName && user.globalName !== user.username}
						<span class="dropdown-display-name">{user.globalName}</span>
					{/if}
				</div>
			</div>
			
			<div class="dropdown-divider"></div>
			
			<a href="/admin" class="dropdown-item" role="menuitem" onclick={closeMenu}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
					<polyline points="9 22 9 12 15 12 15 22"/>
				</svg>
				Dashboard
			</a>
			
			<div class="dropdown-divider"></div>
			
			<a href="/api/auth/logout" class="dropdown-item danger" role="menuitem">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
					<polyline points="16 17 21 12 16 7"/>
					<line x1="21" y1="12" x2="9" y2="12"/>
				</svg>
				Logout
			</a>
		</div>
	{/if}
</div>

<style>
	.user-menu {
		position: relative;
	}
	
	.user-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem 0.375rem 0.375rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	
	.user-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-primary);
	}
	
	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.user-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.chevron {
		color: var(--color-text-muted);
		transition: transform var(--transition-fast);
	}
	
	.open .chevron {
		transform: rotate(180deg);
	}
	
	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}
	
	.dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 220px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		z-index: 100;
		overflow: hidden;
		animation: dropdown-in 0.15s ease-out;
	}
	
	@keyframes dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	
	.dropdown-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
	}
	
	.dropdown-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}
	
	.dropdown-user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	
	.dropdown-username {
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.dropdown-display-name {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.dropdown-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0.25rem 0;
	}
	
	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		color: var(--color-text);
		text-decoration: none;
		font-size: 0.875rem;
		transition: background var(--transition-fast);
	}
	
	.dropdown-item:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}
	
	.dropdown-item svg {
		flex-shrink: 0;
		opacity: 0.7;
	}
	
	.dropdown-item.danger {
		color: var(--color-danger);
	}
	
	.dropdown-item.danger:hover {
		background: rgba(237, 66, 69, 0.1);
		color: var(--color-danger);
	}
	
	@media (max-width: 480px) {
		.user-name {
			display: none;
		}
		
		.user-button {
			padding: 0.25rem;
		}
		
		.chevron {
			display: none;
		}
	}
</style>
