<script>
	import '$lib/styles/global.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-layout">
	<header class="app-header">
		<a href="/" class="logo">SpaceBot</a>
		<nav class="nav">
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
		padding: 1rem 2rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
	}
	
	.logo {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-primary);
		text-decoration: none;
	}
	
	.nav {
		display: flex;
		align-items: center;
		gap: 1rem;
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
