<script>
	let { data } = $props();
</script>

<div class="login-container">
	<h1>Login</h1>
	<p>Sign in with Discord to access your dashboard</p>
	
	<div class="login-card">
		<a href="/api/auth/discord" class="discord-btn">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
				<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
			</svg>
			Sign in with Discord
		</a>
		
		<p class="info">
			After signing in, you'll be able to:
		</p>
		<ul>
			<li>View detailed server statistics</li>
			<li>Manage bot settings</li>
			<li>Configure commands and permissions</li>
		</ul>
	</div>
</div>

<style>
	.login-container {
		max-width: 500px;
		margin: 4rem auto;
		padding: 2rem;
		text-align: center;
	}
	
	h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
		color: #5865F2;
	}
	
	.login-card {
		background: #f9f9f9;
		border-radius: 12px;
		padding: 2rem;
		margin-top: 2rem;
	}
	
	.discord-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2rem;
		background: #5865F2;
		color: white;
		text-decoration: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 1.1rem;
		transition: background 0.2s;
	}
	
	.discord-btn:hover {
		background: #4752C4;
	}
	
	.info {
		margin-top: 2rem;
		color: #666;
		font-size: 0.9rem;
	}
	
	ul {
		text-align: left;
		margin-top: 1rem;
		color: #333;
	}
	
	li {
		margin: 0.5rem 0;
	}
</style>