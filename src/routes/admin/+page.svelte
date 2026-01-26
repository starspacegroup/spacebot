<script>
	let { data } = $props();
</script>

<div class="admin-container">
	<h1>Admin Dashboard</h1>
	
	{#if !data.isAdmin}
		<div class="access-denied">
			<h2>Access Denied</h2>
			<p>You must be logged in as an administrator to access this page.</p>
			<a href="/login" class="btn">Go to Login</a>
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
				<h2>Bot Management</h2>
				<div class="actions">
					<button class="btn">Refresh Commands</button>
					<button class="btn btn-warning">Clear Cache</button>
					<button class="btn btn-danger">Restart Bot</button>
				</div>
			</div>
			
			<div class="section">
				<h2>Configuration</h2>
				<p>Configure bot settings, commands, and permissions here.</p>
				<button class="btn">Edit Configuration</button>
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
	
	.btn {
		padding: 0.75rem 1.5rem;
		border-radius: 4px;
		border: none;
		text-decoration: none;
		background: #5865F2;
		color: white;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.2s;
	}
	
	.btn:hover {
		background: #4752C4;
	}
	
	.btn-warning {
		background: #FEE75C;
		color: #000;
	}
	
	.btn-warning:hover {
		background: #F0D948;
	}
	
	.btn-danger {
		background: #ED4245;
	}
	
	.btn-danger:hover {
		background: #C33537;
	}
</style>