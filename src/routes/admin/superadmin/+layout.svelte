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
		<a href="/admin/superadmin/workflows" class="nav-link">
			<span class="nav-icon">🧭</span>
			Workflows
		</a>
		<a href="/admin/superadmin/stats-import" class="nav-link">
			<span class="nav-icon">📥</span>
			Stats Import
		</a>
		<a href="/admin/superadmin/ai-models" class="nav-link">
			<span class="nav-icon">🤖</span>
			AI Models
		</a>
	</nav>
	{@render children()}
</div>

<style>
	.superadmin-layout {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
		min-width: 0;
	}

	@media (min-width: 640px) {
		.superadmin-layout {
			padding: 1.5rem;
		}
	}

	.superadmin-nav {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.3rem;
		margin-bottom: 1.25rem;
		padding: 0.375rem;
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
	}

	@media (min-width: 640px) {
		.superadmin-nav {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.5rem;
			padding: 0.5rem;
			margin-bottom: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.superadmin-nav {
			display: flex;
			flex-wrap: wrap;
		}
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 500;
		transition: all var(--transition-fast);
		white-space: normal;
		justify-content: center;
		text-align: center;
		min-width: 0;
	}

	@media (min-width: 640px) {
		.nav-link {
			gap: 0.5rem;
			padding: 0.625rem 1rem;
			font-size: 0.9rem;
			justify-content: flex-start;
			text-align: left;
		}
	}

	@media (min-width: 1024px) {
		.nav-link {
			white-space: nowrap;
			flex-shrink: 0;
		}
	}

	.nav-link:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	:global(.superadmin-nav .nav-link[aria-current="page"]) {
		background: var(--color-accent-soft);
		color: var(--color-primary);
	}

	.nav-icon {
		font-size: 1rem;
	}

	@media (min-width: 640px) {
		.nav-icon {
			font-size: 1.1rem;
		}
	}
</style>
