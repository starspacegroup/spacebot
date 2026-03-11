<script>
	let { data } = $props();

	let loading = $state(null); // guild ID currently loading, or null
	let error = $state(null);

	const serversWithBot = $derived(data.adminGuilds.filter(g => g.botIsInServer !== false));
	const serversWithoutBot = $derived(data.adminGuilds.filter(g => g.botIsInServer === false));

	async function startCheckout(guild) {
		loading = guild.id;
		error = null;

		try {
			const res = await fetch('/api/billing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'checkout',
					guildId: guild.id,
					guildName: guild.name,
					interval: data.interval,
					returnUrl: `${window.location.origin}/admin/${guild.id}/account`,
				}),
			});

			const result = await res.json();

			if (!res.ok) {
				if (result.error?.includes('already has an active Pro subscription')) {
					// Already pro — just send them to the dashboard
					window.location.href = `/admin/${guild.id}/account`;
					return;
				}
				throw new Error(result.error || 'Checkout failed');
			}

			// Redirect to Stripe Checkout
			window.location.href = result.url;
		} catch (err) {
			error = err.message;
			loading = null;
		}
	}
</script>

<svelte:head>
	<title>Upgrade to Pro | SpaceBot</title>
</svelte:head>

<div class="upgrade-page">
	<header class="upgrade-header">
		<div class="upgrade-badge">PRO</div>
		<h1>Upgrade to Pro</h1>
		<p class="upgrade-subtitle">
			Select a server to upgrade to Pro
			({data.interval === 'yearly' ? '$2.50/mo billed yearly' : '$3/server/mo'})
		</p>
	</header>

	{#if error}
		<div class="error-banner">
			<span>⚠️</span> {error}
		</div>
	{/if}

	{#if serversWithBot.length > 0}
		<section class="server-section">
			<h2>Your Servers</h2>
			<div class="servers-grid">
				{#each serversWithBot as guild}
					<button
						class="server-card"
						onclick={() => startCheckout(guild)}
						disabled={loading !== null}
					>
						{#if guild.icon}
							<img
								src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=64"
								alt="{guild.name}"
								class="server-icon"
							/>
						{:else}
							<div class="server-icon-placeholder">
								{guild.name?.charAt(0).toUpperCase() || '?'}
							</div>
						{/if}
						<div class="server-info">
							<span class="server-name">{guild.name}</span>
							{#if loading === guild.id}
								<span class="server-status loading">Redirecting to checkout...</span>
							{:else}
								<span class="server-status">Click to upgrade</span>
							{/if}
						</div>
						<span class="server-arrow">
							{#if loading === guild.id}
								<span class="spinner"></span>
							{:else}
								→
							{/if}
						</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	{#if serversWithoutBot.length > 0}
		<section class="server-section">
			<h2>Add Bot First</h2>
			<p class="section-note">These servers don't have SpaceBot yet. Add the bot first, then you can upgrade.</p>
			<div class="servers-grid">
				{#each serversWithoutBot as guild}
					<a
						href="/api/auth/discord?flow=install&guild_id={guild.id}&return_to={encodeURIComponent('/admin/upgrade?interval=' + data.interval)}"
						class="server-card server-card-install"
					>
						{#if guild.icon}
							<img
								src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=64"
								alt="{guild.name}"
								class="server-icon"
							/>
						{:else}
							<div class="server-icon-placeholder">
								{guild.name?.charAt(0).toUpperCase() || '?'}
							</div>
						{/if}
						<div class="server-info">
							<span class="server-name">{guild.name}</span>
							<span class="server-status no-bot">Bot not installed — click to add</span>
						</div>
						<span class="server-arrow">+</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.adminGuilds.length === 0}
		<div class="empty-state">
			<div class="empty-icon"><img src="/logo.webp" alt="SpaceBot" class="bot-logo-lg" /></div>
			<h2>No Servers Found</h2>
			<p>Add SpaceBot to a server first, then come back to upgrade.</p>
			<a href="/api/auth/discord?flow=install&return_to={encodeURIComponent('/admin/upgrade?interval=' + data.interval)}" class="btn btn-primary btn-lg">
				<span>➕</span>
				Add Bot to a Server
			</a>
		</div>
	{/if}

	<div class="add-new-section">
		<p>Don't see your server?</p>
		<a href="/api/auth/discord?flow=install&return_to={encodeURIComponent('/admin/upgrade?interval=' + data.interval)}" class="btn btn-secondary">
			<span><img src="/logo.webp" alt="" class="inline-logo" /></span>
			Add Bot to Another Server
		</a>
	</div>

	<div class="back-link">
		<a href="/#pricing">← Back to pricing</a>
	</div>
</div>

<style>
	.upgrade-page {
		max-width: 700px;
		margin: 0 auto;
		padding: 2rem 1rem;
		min-height: 80vh;
	}

	@media (min-width: 640px) {
		.upgrade-page {
			padding: 3rem 1.5rem;
		}
	}

	.upgrade-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.upgrade-badge {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-primary);
		background: rgba(var(--color-primary-rgb, 124, 58, 237), 0.12);
		padding: 0.25rem 0.75rem;
		border-radius: var(--radius-full, 9999px);
		margin-bottom: 0.75rem;
	}

	.upgrade-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.upgrade-header h1 {
			font-size: 2rem;
		}
	}

	.upgrade-subtitle {
		color: var(--color-text-muted);
		margin: 0;
		font-size: 1rem;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: var(--color-danger, #ef4444);
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 1.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.server-section {
		margin-bottom: 2rem;
	}

	.server-section h2 {
		font-size: 1rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: 0 0 0.75rem;
	}

	.section-note {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: -0.25rem 0 0.75rem;
	}

	.servers-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.server-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-family: inherit;
		font-size: inherit;
		transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
	}

	.server-card:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
		border-color: var(--color-primary);
	}

	.server-card:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.server-card-install {
		border-style: dashed;
	}

	.server-card-install:hover {
		border-style: solid;
	}

	.server-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.server-icon-placeholder {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	.server-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.server-name {
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.server-status {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.server-status.loading {
		color: var(--color-primary);
	}

	.server-status.no-bot {
		color: var(--color-warning, #f59e0b);
	}

	.server-arrow {
		font-size: 1.25rem;
		color: var(--color-text-muted);
		transition: transform var(--transition-fast), color var(--transition-fast);
		flex-shrink: 0;
	}

	.server-card:hover:not(:disabled) .server-arrow {
		transform: translateX(4px);
		color: var(--color-primary);
	}

	.spinner {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		border: 2px dashed var(--color-border);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0 0 1.5rem;
	}

	.add-new-section {
		text-align: center;
		padding: 1.5rem;
		background: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		margin-top: 1.5rem;
	}

	.add-new-section p {
		margin: 0 0 1rem;
		color: var(--color-text-muted);
	}

	.back-link {
		text-align: center;
		margin-top: 2rem;
	}

	.back-link a {
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.back-link a:hover {
		color: var(--color-primary);
	}

	.inline-logo { height: 1.2em; width: auto; vertical-align: middle; border-radius: 4px; }
	.bot-logo-lg { height: 3rem; width: auto; border-radius: 8px; }
</style>
