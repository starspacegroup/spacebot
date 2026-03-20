<script>
	let { children, data } = $props();
</script>

<div class="superadmin-layout">
	<nav class="superadmin-nav">
		<a href="/admin/superadmin" class="nav-link">
			<span class="nav-icon">📊</span>
			Overview
		</a>
		<a href="/admin/superadmin/servers" class="nav-link">
			<span class="nav-icon">🏠</span>
			Servers
		</a>
		<a href="/admin/superadmin/users" class="nav-link">
			<span class="nav-icon">👥</span>
			Users
		</a>
		<a href="/admin/superadmin/gateway" class="nav-link">
			<span class="nav-icon">📡</span>
			Gateway
		</a>
	</nav>
	{@render children()}
</div>

<style>
	.superadmin-layout {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.superadmin-nav {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		padding: 0.5rem;
		background: var(--card-bg, #1a1a2e);
		border-radius: 0.75rem;
		border: 1px solid var(--border-color, #333);
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-radius: 0.5rem;
		color: var(--text-secondary, #aaa);
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.nav-link:hover {
		background: var(--hover-bg, rgba(255, 255, 255, 0.05));
		color: var(--text-primary, #fff);
	}

	/* Active link gets highlighted via SvelteKit :global */
	:global(.superadmin-nav .nav-link[aria-current="page"]) {
		background: var(--accent-bg, rgba(99, 102, 241, 0.15));
		color: var(--accent-color, #818cf8);
	}

	.nav-icon {
		font-size: 1.1rem;
	}

	@media (max-width: 640px) {
		.superadmin-layout {
			padding: 1rem;
		}

		.superadmin-nav {
			overflow-x: auto;
		}

		.nav-link {
			white-space: nowrap;
			font-size: 0.85rem;
			padding: 0.5rem 0.75rem;
		}
	}
</style>
