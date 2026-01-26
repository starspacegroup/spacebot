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
		color: var(--color-primary);
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
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		text-align: center;
	}
	
	.stat-card h3 {
		margin: 0 0 0.5rem 0;
		color: var(--color-text-muted);
	}
	
	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: var(--color-primary);
		margin: 0;
	}
</style>
