<script>
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Admin Dashboard | SpaceBot</title>
</svelte:head>

<div class="admin-dashboard">
	{#if form?.message}
		<div class="toast {form.success ? 'toast-success' : 'toast-error'}">
			<span class="toast-icon">{form.success ? '✓' : '✕'}</span>
			<span>{form.message}</span>
		</div>
	{/if}
	
	{#if !data.isAdmin}
		<!-- Access Denied State -->
		<div class="access-denied-container">
			<div class="access-denied-card">
				<div class="access-denied-icon">🔒</div>
				<h1>Access Denied</h1>
				<p>You need to be an administrator of a server where the bot is installed to access this dashboard.</p>
				{#if data.user}
					<p class="hint">If you're a server admin, make sure the bot is added to your server first.</p>
					<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-lg">
						<span class="btn-icon">🤖</span>
						Add Bot to a Server
					</a>
				{:else}
					<a href="/login" class="btn btn-primary btn-lg">
						<span class="btn-icon">🔑</span>
						Login with Discord
					</a>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Server Selection -->
		<header class="dashboard-header">
			<div class="header-content">
				<h1>
					<span class="header-icon">🚀</span>
					Admin Dashboard
				</h1>
				<p class="header-subtitle">Select a server to manage</p>
			</div>
		</header>
		
		{#if data.adminGuilds && data.adminGuilds.length > 0}
			<section class="servers-section">
				<div class="servers-grid">
					{#each data.adminGuilds as guild}
						<a href="/admin/{guild.id}" class="server-card {guild.botIsInServer === false ? 'no-bot' : ''}">
							{#if guild.icon}
								<img 
									src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png" 
									alt="{guild.name} icon"
									class="server-icon"
								/>
							{:else}
								<div class="server-icon-placeholder">
									{guild.name?.charAt(0).toUpperCase() || '?'}
								</div>
							{/if}
							<div class="server-info">
								<span class="server-name">{guild.name}</span>
								{#if guild.botIsInServer === false}
									<span class="server-status no-bot">Bot not installed</span>
								{:else}
									<span class="server-status">Ready to manage</span>
								{/if}
							</div>
							<span class="server-arrow">→</span>
						</a>
					{/each}
				</div>
			</section>
			
			<div class="add-server-section">
				<p>Don't see your server?</p>
				<a href="/api/auth/discord?flow=install" class="btn btn-secondary">
					<span>🤖</span>
					Add Bot to Another Server
				</a>
			</div>
		{:else}
			<div class="empty-state-card">
				<div class="empty-icon">🤖</div>
				<h2>No Servers Found</h2>
				<p>Add the bot to a server where you're an admin to get started.</p>
				<a href="/api/auth/discord?flow=install" class="btn btn-primary btn-lg">
					<span class="btn-icon">➕</span>
					Add Bot to a Server
				</a>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Base Dashboard Styles */
	.admin-dashboard {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem;
		min-height: 100vh;
	}
	
	@media (min-width: 640px) {
		.admin-dashboard {
			padding: 1.5rem;
		}
	}
	
	@media (min-width: 1024px) {
		.admin-dashboard {
			padding: 2rem;
		}
	}
	
	/* Toast Notifications */
	.toast {
		position: fixed;
		top: 1rem;
		right: 1rem;
		left: 1rem;
		max-width: 400px;
		margin-left: auto;
		padding: 1rem 1.25rem;
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-weight: 500;
		z-index: 100;
		animation: slideIn 0.3s ease;
		box-shadow: var(--shadow-lg);
	}
	
	@keyframes slideIn {
		from { transform: translateY(-20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
	
	.toast-success {
		background: linear-gradient(135deg, #22c55e, #16a34a);
		color: white;
	}
	
	.toast-error {
		background: linear-gradient(135deg, #ef4444, #dc2626);
		color: white;
	}
	
	.toast-icon {
		font-size: 1.25rem;
	}
	
	/* Access Denied */
	.access-denied-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
	}
	
	.access-denied-card {
		text-align: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		max-width: 400px;
		width: 100%;
	}
	
	@media (min-width: 640px) {
		.access-denied-card {
			padding: 3rem;
		}
	}
	
	.access-denied-icon {
		font-size: 4rem;
		margin-bottom: 1.5rem;
	}
	
	.access-denied-card h1 {
		font-size: 1.5rem;
		margin: 0 0 1rem;
		color: var(--color-text);
	}
	
	.access-denied-card p {
		color: var(--color-text-muted);
		margin: 0 0 1rem;
	}
	
	.access-denied-card .hint {
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}
	
	/* Dashboard Header */
	.dashboard-header {
		margin-bottom: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.dashboard-header {
			margin-bottom: 2rem;
		}
	}
	
	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.header-content h1 {
			font-size: 2rem;
		}
	}
	
	.header-icon {
		font-size: 1.5rem;
	}
	
	@media (min-width: 640px) {
		.header-icon {
			font-size: 2rem;
		}
	}
	
	.header-subtitle {
		margin: 0.5rem 0 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	/* Servers Section */
	.servers-section {
		margin-bottom: 2rem;
	}
	
	.servers-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	
	@media (min-width: 640px) {
		.servers-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1rem;
		}
	}
	
	@media (min-width: 1024px) {
		.servers-grid {
			grid-template-columns: repeat(3, 1fr);
		}
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
		transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
	}
	
	.server-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
		border-color: var(--color-primary);
	}
	
	.server-card.no-bot {
		opacity: 0.7;
	}
	
	.server-card.no-bot:hover {
		border-color: var(--color-border);
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
		background: var(--color-primary);
		color: white;
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
	
	.server-status.no-bot {
		color: #f59e0b;
	}
	
	.server-arrow {
		font-size: 1.25rem;
		color: var(--color-text-muted);
		transition: transform var(--transition-fast), color var(--transition-fast);
	}
	
	.server-card:hover .server-arrow {
		transform: translateX(4px);
		color: var(--color-primary);
	}
	
	/* Add Server Section */
	.add-server-section {
		text-align: center;
		padding: 1.5rem;
		background: var(--color-surface);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	.add-server-section p {
		margin: 0 0 1rem;
		color: var(--color-text-muted);
	}
	
	/* Empty State */
	.empty-state-card {
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
	
	.empty-state-card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: var(--color-text);
	}
	
	.empty-state-card p {
		color: var(--color-text-muted);
		margin: 0 0 1.5rem;
	}
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-md);
		border: none;
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all var(--transition-fast);
		text-decoration: none;
	}
	
	.btn-primary {
		background: var(--color-primary);
		color: white;
	}
	
	.btn-primary:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.btn-secondary {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	
	.btn-secondary:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-primary);
	}
	
	.btn-lg {
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-icon {
		font-size: 1.1em;
	}
</style>