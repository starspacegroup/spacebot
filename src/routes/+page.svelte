<script>
	let { data } = $props();
</script>

<div class="container">
	<h1>SpaceBot Dashboard</h1>
	<p>A Discord bot for managing your community</p>
	
	<div class="stats">
		<h2>Public Stats</h2>
		<div class="stat-grid">
			<div class="stat-card">
				<h3>Servers</h3>
				<p class="stat-value">{data.stats?.servers || 0}</p>
			</div>
			<div class="stat-card">
				<h3>Users</h3>
				<p class="stat-value">{data.stats?.users || 0}</p>
			</div>
			<div class="stat-card">
				<h3>Commands</h3>
				<p class="stat-value">{data.stats?.commands || 0}</p>
			</div>
		</div>
	</div>
	
	<div class="actions">
		<a href="/login" class="btn">Login</a>
		<a href="/admin" class="btn btn-secondary">Admin</a>
	</div>
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}
	
	h1 {
		font-size: 2.5rem;
		margin-bottom: 1rem;
		color: #5865F2;
	}
	
	.stats {
		margin: 2rem 0;
	}
	
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	
	.stat-card {
		background: #f0f0f0;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
	}
	
	.stat-card h3 {
		margin: 0 0 0.5rem 0;
		color: #333;
	}
	
	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: #5865F2;
		margin: 0;
	}
	
	.actions {
		margin-top: 2rem;
		display: flex;
		gap: 1rem;
	}
	
	.btn {
		padding: 0.75rem 1.5rem;
		border-radius: 4px;
		text-decoration: none;
		background: #5865F2;
		color: white;
		font-weight: 500;
		transition: background 0.2s;
	}
	
	.btn:hover {
		background: #4752C4;
	}
	
	.btn-secondary {
		background: #57F287;
		color: #000;
	}
	
	.btn-secondary:hover {
		background: #3BA55D;
	}
</style>
