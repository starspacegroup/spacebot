<script>
	import '$lib/styles/global.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import ServerSelector from '$lib/components/ServerSelector.svelte';
	import { page } from '$app/stores';

	let { children, data } = $props();
	
	// Use $page.data for the most up-to-date merged data from layout + page
	const adminGuilds = $derived($page.data.adminGuilds || []);
	const selectedGuildId = $derived($page.data.selectedGuildId || $page.url.searchParams.get('guild'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-layout">
	<header class="app-header">
		<a href="/" class="logo">SpaceBot</a>
		<nav class="nav">
			{#if $page.url.pathname.startsWith('/admin')}
				<ServerSelector 
					guilds={adminGuilds} 
					selectedGuildId={selectedGuildId}
				/>
			{/if}
			{#if data.isLoggedIn && data.user}
				<UserMenu user={data.user} />
			{:else}
				<a href="/login" class="nav-btn">Login</a>
			{/if}
			<ThemeToggle />
		</nav>
	</header>
	
	<main class="app-main">
		{@render children()}
	</main>
</div>

<style>
	.app-layout {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
	
	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		gap: 0.5rem;
	}
	
	.logo {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-primary);
		text-decoration: none;
		flex-shrink: 0;
	}
	
	.nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	
	@media (min-width: 640px) {
		.app-header {
			padding: 0.75rem 1.5rem;
		}
		
		.logo {
			font-size: 1.25rem;
		}
		
		.nav {
			gap: 0.75rem;
		}
	}
	
	.nav-btn {
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--color-primary);
		color: white;
		text-decoration: none;
		font-weight: 500;
		transition: background var(--transition-fast);
	}
	
	.nav-btn:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.app-main {
		flex: 1;
	}
</style>
