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
			<p>You must be logged in as an administrator to access this page.</p>
			<a href="/login" class="btn">Go to Login</a>
		</div>
	{:else}
		<div class="user-info">
			<p>Logged in as: <strong>{data.user?.username || 'Unknown'}</strong></p>
			<form method="POST" action="?/logout" use:enhance>
				<button type="submit" class="btn btn-small">Logout</button>
			</form>
		</div>
		
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
				<h2>Bot Management</h2>
				<div class="actions">
					<form method="POST" action="?/refreshCommands" use:enhance={() => {
						loading = 'refreshCommands';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn" disabled={loading === 'refreshCommands'}>
							{loading === 'refreshCommands' ? 'Registering...' : 'Refresh Commands'}
						</button>
					</form>
					
					<form method="POST" action="?/clearCache" use:enhance={() => {
						loading = 'clearCache';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn btn-warning" disabled={loading === 'clearCache'}>
							{loading === 'clearCache' ? 'Clearing...' : 'Clear Cache'}
						</button>
					</form>
					
					<form method="POST" action="?/restartBot" use:enhance={() => {
						loading = 'restartBot';
						return async ({ update }) => {
							await update();
							loading = null;
						};
					}}>
						<button type="submit" class="btn btn-danger" disabled={loading === 'restartBot'}>
							{loading === 'restartBot' ? 'Restarting...' : 'Restart Bot'}
						</button>
					</form>
				</div>
			</div>
			
			<div class="section">
				<h2>Configuration</h2>
				<p>Configure bot settings, commands, and permissions here.</p>
				<a href="/admin/config" class="btn">Edit Configuration</a>
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}
	
	h1 {
		font-size: 2.5rem;
		margin-bottom: 2rem;
		color: #5865F2;
	}
	
	h2 {
		font-size: 1.75rem;
		margin-bottom: 1rem;
		color: #333;
	}
	
	.alert {
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-weight: 500;
	}
	
	.alert-success {
		background: #D4EDDA;
		color: #155724;
		border: 1px solid #C3E6CB;
	}
	
	.alert-error {
		background: #F8D7DA;
		color: #721C24;
		border: 1px solid #F5C6CB;
	}
	
	.user-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
		padding: 1rem;
		background: #f0f0f0;
		border-radius: 8px;
	}
	
	.user-info p {
		margin: 0;
	}
	
	.access-denied {
		text-align: center;
		padding: 4rem 2rem;
		background: #f9f9f9;
		border-radius: 12px;
	}
	
	.section {
		margin-bottom: 2rem;
		background: #f9f9f9;
		padding: 1.5rem;
		border-radius: 12px;
	}
	
	.status-card {
		background: white;
		padding: 1rem;
		border-radius: 8px;
	}
	
	.status-online {
		color: #3BA55D;
		font-weight: bold;
	}
	
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	
	.stat-card {
		background: white;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
	}
	
	.stat-card h3 {
		margin: 0 0 0.5rem 0;
		color: #333;
		font-size: 1rem;
	}
	
	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: #5865F2;
		margin: 0;
	}
	
	.actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.actions form {
		display: inline-block;
	}
	
	.commands-list {
		background: white;
		padding: 1rem;
		border-radius: 8px;
	}
	
	.commands-list ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	
	.commands-list li {
		padding: 0.5rem 0;
		border-bottom: 1px solid #eee;
	}
	
	.commands-list li:last-child {
		border-bottom: none;
	}
	
	.commands-list code {
		background: #e8e8e8;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-weight: bold;
		color: #5865F2;
	}
	
	.btn {
		padding: 0.75rem 1.5rem;
		border-radius: 4px;
		border: none;
		text-decoration: none;
		background: #5865F2;
		color: white;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.2s, opacity 0.2s;
		display: inline-block;
	}
	
	.btn:hover:not(:disabled) {
		background: #4752C4;
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-small {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
	}
	
	.btn-warning {
		background: #FEE75C;
		color: #000;
	}
	
	.btn-warning:hover:not(:disabled) {
		background: #F0D948;
	}
	
	.btn-danger {
		background: #ED4245;
	}
	
	.btn-danger:hover:not(:disabled) {
		background: #C33537;
	}
</style>