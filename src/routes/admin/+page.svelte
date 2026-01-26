<script>
	import { enhance } from '$app/forms';
	
	let { data, form } = $props();
	let loading = $state(null);
</script>

<div class="admin-container">
	<h1>Admin Dashboard</h1>
	
	{#if form?.message}
		<div class="alert {form.success ? 'alert-success' : 'alert-error'}">
			{form.message}
		</div>
	{/if}
	
	{#if !data.isAdmin}
		<div class="access-denied">
			<h2>Access Denied</h2>
			<p>You need to be an administrator of a server where the bot is installed to access this page.</p>
			{#if data.user}
				<p class="access-hint">If you're a server admin, make sure the bot is added to your server first.</p>
				<a href="/api/auth/discord?flow=install" class="btn">Add Bot to a Server</a>
			{:else}
				<a href="/login" class="btn">Go to Login</a>
			{/if}
		</div>
	{:else}
		<div class="admin-content">
			<div class="section">
				<h2>Bot Status</h2>
				<div class="status-card">
					<p><strong>Status:</strong> <span class="status-online">Online</span></p>
					<p><strong>Uptime:</strong> {data.uptime || 'N/A'}</p>
					<p><strong>Latency:</strong> {data.latency || 'N/A'}ms</p>
				</div>
			</div>
			
			<div class="section">
				<h2>Server Statistics</h2>
				<div class="stats-grid">
					<div class="stat-card">
						<h3>Total Servers</h3>
						<p class="stat-value">{data.stats?.servers || 0}</p>
					</div>
					<div class="stat-card">
						<h3>Total Users</h3>
						<p class="stat-value">{data.stats?.users || 0}</p>
					</div>
					<div class="stat-card">
						<h3>Commands Used</h3>
						<p class="stat-value">{data.stats?.commandsUsed || 0}</p>
					</div>
				</div>
			</div>
			
			<div class="section">
				<h2>Registered Commands</h2>
				<div class="commands-list">
					{#if data.commands && data.commands.length > 0}
						<ul>
							{#each data.commands as command}
								<li>
									<code>/{command.name}</code> - {command.description}
								</li>
							{/each}
						</ul>
					{:else}
						<p>No commands registered.</p>
					{/if}
				</div>
			</div>
			
			<div class="section">
				<h2>📊 Event Logs</h2>
				<p>View all server activity including member joins/leaves, messages, voice activity, moderation actions, and more.</p>
				{#if data.selectedGuildId}
					{@const selectedGuild = data.adminGuilds?.find(g => g.id === data.selectedGuildId)}
					{#if selectedGuild?.botIsInServer === false}
						<p class="warning-text">⚠️ Bot must be installed in this server to view logs.</p>
						<a href="/api/auth/discord?flow=install" class="btn">Add Bot to Server</a>
					{:else}
						<a href="/admin/{data.selectedGuildId}/logs" class="btn btn-logs">📜 View Server Logs</a>
					{/if}
				{:else}
					<p class="no-servers">Select a server above to view logs.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}
	
	h1 {
		font-size: 1.5rem;
		margin-bottom: 1rem;
		color: var(--color-primary);
	}
	
	h2 {
		font-size: 1.25rem;
		margin-bottom: 0.75rem;
		color: var(--color-text);
	}
	
	@media (min-width: 640px) {
		.admin-container {
			padding: 1.5rem;
		}
		
		h1 {
			font-size: 2rem;
			margin-bottom: 1.5rem;
		}
		
		h2 {
			font-size: 1.5rem;
			margin-bottom: 1rem;
		}
	}
	
	@media (min-width: 1024px) {
		.admin-container {
			padding: 2rem;
		}
		
		h1 {
			font-size: 2.5rem;
			margin-bottom: 2rem;
		}
		
		h2 {
			font-size: 1.75rem;
		}
	}
	
	.alert {
		padding: 1rem;
		border-radius: var(--radius-md);
		margin-bottom: 1.5rem;
		font-weight: 500;
	}
	
	.alert-success {
		background: rgba(87, 242, 135, 0.15);
		color: var(--color-success-hover);
		border: 1px solid var(--color-success);
	}
	
	.alert-error {
		background: rgba(237, 66, 69, 0.15);
		color: var(--color-danger);
		border: 1px solid var(--color-danger);
	}
	
	.access-denied {
		text-align: center;
		padding: 2rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	
	@media (min-width: 640px) {
		.access-denied {
			padding: 4rem 2rem;
		}
	}
	
	.section {
		margin-bottom: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		padding: 1rem;
		border-radius: var(--radius-md);
	}
	
	@media (min-width: 640px) {
		.section {
			margin-bottom: 1.5rem;
			padding: 1.25rem;
			border-radius: var(--radius-lg);
		}
	}
	
	@media (min-width: 1024px) {
		.section {
			margin-bottom: 2rem;
			padding: 1.5rem;
		}
	}
	
	.status-card {
		background: var(--color-surface-elevated);
		padding: 1rem;
		border-radius: var(--radius-md);
	}
	
	.status-online {
		color: var(--color-success);
		font-weight: bold;
	}
	
	.stats-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	
	@media (min-width: 480px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	
	@media (min-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 1rem;
			margin-top: 1rem;
		}
	}
	
	.stat-card {
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		padding: 1rem;
		text-align: center;
	}
	
	@media (min-width: 640px) {
		.stat-card {
			padding: 1.5rem;
		}
	}
	
	.stat-card h3 {
		margin: 0 0 0.25rem 0;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
	
	@media (min-width: 640px) {
		.stat-card h3 {
			margin: 0 0 0.5rem 0;
			font-size: 1rem;
		}
	}
	
	.stat-value {
		font-size: 1.5rem;
		font-weight: bold;
		color: var(--color-primary);
		margin: 0;
	}
	
	@media (min-width: 640px) {
		.stat-value {
			font-size: 2rem;
		}
	}
	
	.commands-list {
		background: var(--color-surface-elevated);
		padding: 0.75rem;
		border-radius: var(--radius-md);
	}
	
	@media (min-width: 640px) {
		.commands-list {
			padding: 1rem;
		}
	}
	
	.commands-list ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	
	.commands-list li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.875rem;
	}
	
	@media (min-width: 640px) {
		.commands-list li {
			font-size: 1rem;
		}
	}
	
	.commands-list li:last-child {
		border-bottom: none;
	}
	
	.commands-list code {
		background: var(--color-surface-hover);
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		font-weight: bold;
		color: var(--color-primary);
	}
	
	.btn {
		padding: 0.625rem 1rem;
		border-radius: var(--radius-sm);
		border: none;
		text-decoration: none;
		background: var(--color-primary);
		color: white;
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background var(--transition-fast), opacity var(--transition-fast);
		display: inline-block;
	}
	
	@media (min-width: 640px) {
		.btn {
			padding: 0.75rem 1.5rem;
			font-size: 1rem;
		}
	}
	
	.btn:hover:not(:disabled) {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-logs {
		background: linear-gradient(135deg, #5865F2, #7289DA);
	}
	
	.btn-logs:hover:not(:disabled) {
		background: linear-gradient(135deg, #4752C4, #5865F2);
	}
	
	.warning-text {
		color: #fab116;
		margin-bottom: 1rem;
	}
	
	.no-servers {
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}
	
	.access-hint {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-bottom: 1.5rem;
	}
</style>