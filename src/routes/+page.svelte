<script>
	let { data } = $props();
</script>

<div class="container">
	<h1>SpaceBot Dashboard</h1>
	<p class="subtitle">Servers the bot is currently in</p>

	{#if data.error}
		<div class="error-message">
			<p>{data.error}</p>
		</div>
	{:else if data.guilds.length === 0}
		<div class="empty-state">
			<p>The bot is not in any servers yet.</p>
			<p class="hint">Add the bot to a server to see it listed here.</p>
		</div>
	{:else}
		<div class="server-grid">
			{#each data.guilds as guild}
				<div class="server-card">
					<div class="server-icon">
						{#if guild.icon}
							<img src={guild.icon} alt="{guild.name} icon" />
						{:else}
							<div class="default-icon">
								{guild.name.charAt(0).toUpperCase()}
							</div>
						{/if}
					</div>
					<div class="server-info">
						<h3>{guild.name}</h3>
						{#if guild.owner}
							<span class="owner-badge">Owner</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<p class="server-count">{data.guilds.length} server{data.guilds.length === 1 ? '' : 's'}</p>
	{/if}
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
		color: var(--color-primary);
	}

	.subtitle {
		color: var(--color-text-muted);
		margin-bottom: 2rem;
	}

	.error-message {
		background: var(--color-error, #dc2626);
		color: white;
		padding: 1rem;
		border-radius: var(--radius-md);
		margin: 2rem 0;
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.empty-state .hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.server-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.server-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.server-card:hover {
		border-color: var(--color-primary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.server-icon {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		overflow: hidden;
	}

	.server-icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.default-icon {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-primary);
		color: white;
		font-size: 1.25rem;
		font-weight: bold;
	}

	.server-info {
		min-width: 0;
	}

	.server-info h3 {
		margin: 0;
		font-size: 1rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.owner-badge {
		display: inline-block;
		background: var(--color-primary);
		color: white;
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		margin-top: 0.25rem;
	}

	.server-count {
		text-align: center;
		color: var(--color-text-muted);
		margin-top: 1.5rem;
	}
</style>
