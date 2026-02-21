<script>
	import '$lib/styles/global.css';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import ServerSelector from '$lib/components/ServerSelector.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { page } from '$app/stores';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/stores';

	let { children, data } = $props();
	
	// Force a full page reload when the app version changes.
	// This prevents stale client-side route manifests from loading
	// the wrong page component (e.g. showing logs page at /integrations).
	// Critical when HMR is disabled (tunnel / production).
	beforeNavigate(({ willUnload, to }) => {
		if ($updated && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});
	
	// Track if we've received valid data to prevent flash during hydration
	let hasInitialized = $state(false);
	
	$effect(() => {
		if (data && data.user !== undefined) {
			hasInitialized = true;
		}
	});
	
	// Use data prop for layout data
	const isLoggedIn = $derived(data?.isLoggedIn ?? false);
	const user = $derived(data?.user ?? null);
	const adminGuilds = $derived(data?.adminGuilds ?? []);
	const selectedGuildId = $derived(data?.selectedGuildId ?? $page.url.searchParams.get('guild'));
	const isSuperAdmin = $derived(data?.isSuperAdmin ?? false);
	
	// Only show login button after initialization to prevent flash
	const showLoginButton = $derived(hasInitialized && !isLoggedIn);
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />
</svelte:head>

<div class="app-layout">
	<header class="app-header">
		<a href="/" class="logo">
			<img src="/logo.webp" alt="SpaceBot" class="logo-img" width="28" height="28" />
			SpaceBot
		</a>
		<nav class="nav">
			{#if $page.url.pathname.startsWith('/admin') && adminGuilds.length > 0}
				<ServerSelector 
					guilds={adminGuilds} 
					selectedGuildId={selectedGuildId}
				/>
			{/if}
			{#if isLoggedIn && user}
				<UserMenu user={user} selectedGuildId={selectedGuildId} isSuperAdmin={isSuperAdmin} />
			{:else if showLoginButton}
				<a href="/login" class="nav-btn">Login</a>
			{/if}
			<ThemeToggle />
		</nav>
	</header>
	
	<main class="app-main">
		{@render children()}
	</main>
	
	<Footer />
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.logo-img {
		border-radius: 6px;
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
