<script lang="ts">
	import '$lib/styles/global.css';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import ServerSelector from '$lib/components/ServerSelector.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { commandPalette } from '$lib/command-palette.svelte.js';
	import { page } from '$app/stores';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/stores';
	import {
		applyServerTheme,
		clearServerTheme,
		preloadGuildHues,
	} from '$lib/server-theme.svelte.js';

	const { children, data } = $props();

	// Detect the user's browser timezone and store it in a cookie so
	// server-side code (SQL date grouping, etc.) can use the viewer's timezone.
	$effect(() => {
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (tz && document.cookie.indexOf('user_timezone=' + tz) === -1) {
				document.cookie = `user_timezone=${encodeURIComponent(tz)};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
			}
		} catch {
			// Intl API not available — cookie won't be set; server falls back to UTC
		}
	});

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
	const selectedGuildId = $derived(data?.selectedGuildId ?? $page.url.searchParams.get('guild'));
	const isSuperAdmin = $derived(data?.isSuperAdmin ?? false);

	// adminGuilds may arrive as a streamed Promise (to avoid blocking page render on Discord API).
	// Resolve it reactively so the server selector appears once the list is ready.
	// `guildsPending` distinguishes "still streaming" from "resolved but empty" so the
	// loading skeleton never sticks for users who genuinely have no admin guilds.
	let adminGuilds = $state([]);
	let guildsPending = $state(false);
	$effect(() => {
		const raw: any = data?.adminGuilds;
		if (!raw) {
			adminGuilds = [];
			guildsPending = false;
			return;
		}
		if (typeof raw?.then === 'function') {
			// Streamed Promise — page already rendered, now fill in the guild list
			guildsPending = true;
			raw.then((guilds) => {
				adminGuilds = guilds ?? [];
			})
				.catch(() => {
					adminGuilds = [];
				})
				.finally(() => {
					guildsPending = false;
				});
		} else {
			// Already resolved array (dev bypass, first-ever visit, or non-admin page)
			adminGuilds = raw;
			guildsPending = false;
		}
	});

	// Show the server-selector skeleton only while the streamed guild list is in flight
	// on an admin (non-superadmin) route — a real loading state, not a permanent fallback.
	const showSelectorSkeleton = $derived(
		guildsPending &&
			adminGuilds.length === 0 &&
			$page.url.pathname.startsWith('/admin') &&
			!$page.url.pathname.startsWith('/admin/superadmin')
	);

	// Only show login button after initialization to prevent flash
	const showLoginButton = $derived(hasInitialized && !isLoggedIn);

	// Pre-extract hues for all admin guilds so switching servers is instant.
	$effect(() => {
		if (adminGuilds.length > 0) {
			preloadGuildHues(adminGuilds);
		}
	});

	// Apply server-specific accent color when viewing a server's admin pages.
	// Extracts the dominant color from the guild's Discord icon and uses it
	// to tint the entire UI, giving each server a branded feel.
	// Prefers stored guild metadata (from daily cron) over OAuth guild data.
	$effect(() => {
		const pathname = $page.url.pathname;
		const match = pathname.match(/^\/admin\/(\d{17,20})/);

		if (match) {
			const serverId = match[1];
			// Prefer guild metadata from page data (stored by cron, has richer info)
			const metadata = $page.data?.guildMetadata;
			const guild = adminGuilds.find((g) => g.id === serverId);
			const iconHash = metadata?.icon || guild?.icon;

			if (iconHash) {
				applyServerTheme(serverId, iconHash);
			} else {
				clearServerTheme();
			}
		} else {
			clearServerTheme();
		}
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />

	<!-- Open Graph defaults (overridden per-page via svelte:head) -->
	<meta property="og:site_name" content="SpaceBot" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="SpaceBot – Discord Bot Platform" />
	<meta
		property="og:description"
		content="A powerful Discord bot platform with custom commands, automations, AI assistant, server analytics, and integrations."
	/>
	<meta property="og:image" content="https://spacebot.starspace.group/logo.jpg" />
	<meta property="og:url" content="https://spacebot.starspace.group" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="SpaceBot – Discord Bot Platform" />
	<meta
		name="twitter:description"
		content="A powerful Discord bot platform with custom commands, automations, AI assistant, server analytics, and integrations."
	/>
	<meta name="twitter:image" content="https://spacebot.starspace.group/logo.jpg" />

	<meta name="theme-color" content="#0D0B1A" />
</svelte:head>

<div class="app-layout" class:chat-page={$page.url.pathname.endsWith('/chat')}>
	<header class="app-header">
		<a href={isLoggedIn ? '/admin' : '/'} class="logo">
			<img src="/logo.webp" alt="SpaceBot" class="logo-img" width="28" height="28" />
			SpaceBot
		</a>
		<button
			class="palette-trigger"
			onclick={() => commandPalette.open()}
			aria-label="Open command palette"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
			>
			<span class="palette-trigger-key"
				>{typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
					? '⌘'
					: 'Ctrl+'}K</span
			>
		</button>
		<nav class="nav">
			{#if $page.url.pathname.startsWith('/admin') && !$page.url.pathname.startsWith('/admin/superadmin') && adminGuilds.length > 0}
				<ServerSelector guilds={adminGuilds} {selectedGuildId} />
			{:else if showSelectorSkeleton}
				<Skeleton width="11rem" height="2.25rem" radius="var(--radius-full)" />
			{/if}
			{#if isLoggedIn && user}
				<UserMenu {user} {selectedGuildId} {isSuperAdmin} />
			{:else if showLoginButton}
				<a href="/#pricing" class="nav-link">Pricing</a>
				<a href="/api/auth/discord" class="nav-btn"
					><svg
						class="discord-icon"
						width="16"
						height="16"
						viewBox="0 0 71 55"
						fill="currentColor"
						xmlns="http://www.w3.org/2000/svg"
						><path
							d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.2 5.3 35.7 0a.2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4c-1.8 1-3.6 1.9-5.6 2.6a.2.2 0 0 0-.1.3 47.3 47.3 0 0 0 3.7 5.9.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-15-2.3-28.4-9.8-40.1a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.8 7.1-6.3 7.1Zm23.3 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.1 6.3-7.1 6.4 3.2 6.3 7.1c0 3.9-2.7 7.1-6.3 7.1Z"
						/></svg
					> Login</a
				>
			{/if}
			<ThemeToggle />
		</nav>
	</header>

	<main class="app-main">
		{@render children()}
	</main>

	{#if !$page.url.pathname.endsWith('/chat')}
		<Footer />
	{/if}

	<CommandPalette {isLoggedIn} {user} {adminGuilds} {selectedGuildId} {isSuperAdmin} />

	<ToastContainer />
</div>

<style>
	.app-layout {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.app-header {
		position: relative;
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
		gap: 0.75rem;
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

	.nav-link {
		color: var(--color-text-secondary);
		text-decoration: none;
		font-weight: 500;
		font-size: 0.875rem;
		transition: color var(--transition-fast);
	}

	.nav-link:hover {
		color: var(--color-text);
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		text-decoration: none;
		font-weight: 500;
		transition: background var(--transition-fast);
	}

	.nav-btn:hover {
		background: var(--color-primary-button-hover);
		color: var(--color-primary-button-text);
	}

	.app-main {
		flex: 1;
		min-height: 0;
	}

	.chat-page {
		height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
	}

	.chat-page .app-main {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.palette-trigger {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.3rem 0.625rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-family: inherit;
		transition:
			border-color var(--transition-fast),
			color var(--transition-fast),
			background var(--transition-fast);
		white-space: nowrap;
	}

	.palette-trigger:hover {
		border-color: var(--color-primary);
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.palette-trigger-key {
		font-size: 0.675rem;
		opacity: 0.7;
	}

	@media (max-width: 640px) {
		.palette-trigger {
			position: static;
			transform: none;
		}
		.palette-trigger-key {
			display: none;
		}
	}
</style>
