<script>
	let { data } = $props();
	
	// Get error from URL if present
	const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
	const error = urlParams?.get('error');
	
	const errorMessages = {
		'no_code': 'Authorization was cancelled or failed.',
		'invalid_state': 'Session expired. Please try again.',
		'config': 'Server configuration error. Please contact support.',
		'auth_failed': 'Authentication failed. Please try again.',
		'access_denied': 'You denied the authorization request.'
	};
</script>

<div class="login-container">
	<h1>Login</h1>
	<p>Sign in with Discord to access your dashboard</p>
	
	{#if error}
		<div class="error-banner">
			{errorMessages[error] || 'An error occurred. Please try again.'}
		</div>
	{/if}
	
	{#if data.isLoggedIn}
		<div class="logged-in-card">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" class="check-icon">
				<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
			</svg>
			<p class="logged-in-message">You're already signed in!</p>
			{#if data.isAdmin}
				<a href="/admin" class="dashboard-btn">Go to Dashboard</a>
			{:else}
				<a href="/" class="dashboard-btn">Go to Home</a>
			{/if}
		</div>
	{:else}
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
	{/if}
	
	{#if data.isLoggedIn && data.isAdmin}
		<div class="install-card">
			<h2>Add Bot to Server</h2>
			<p class="install-info">
				Need to add SpaceBot to your server? Use the OAuth2 Code Grant flow 
				to ensure proper authorization before the bot joins.
			</p>
			<a href="/api/auth/discord?flow=install" class="install-btn">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
				</svg>
				Add to Server
			</a>
			<p class="install-note">
				This will request bot permissions and log you in simultaneously.
			</p>
		</div>
	{/if}
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
		color: var(--color-primary);
	}
	
	.error-banner {
		background: rgba(237, 66, 69, 0.1);
		border: 1px solid var(--color-danger);
		color: var(--color-danger);
		padding: 1rem;
		border-radius: var(--radius-md);
		margin: 1rem 0;
	}
	
	.login-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		margin-top: 2rem;
	}
	
	.logged-in-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		margin-top: 2rem;
	}
	
	.logged-in-card .check-icon {
		color: var(--color-success, #43b581);
		margin-bottom: 1rem;
	}
	
	.logged-in-message {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1.5rem;
	}
	
	.dashboard-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-primary);
		color: white;
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		transition: background var(--transition-fast);
	}
	
	.dashboard-btn:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.discord-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2rem;
		background: var(--color-primary);
		color: white;
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1.1rem;
		transition: background var(--transition-fast);
	}
	
	.discord-btn:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.info {
		margin-top: 2rem;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	
	ul {
		text-align: left;
		margin-top: 1rem;
		color: var(--color-text);
	}
	
	li {
		margin: 0.5rem 0;
	}
	
	.install-card {
		background: var(--color-primary-soft);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2rem;
		margin-top: 2rem;
	}
	
	.install-card h2 {
		font-size: 1.25rem;
		color: var(--color-primary);
		margin: 0 0 0.5rem 0;
	}
	
	.install-info {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}
	
	.install-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-primary);
		color: white;
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		transition: background var(--transition-fast);
	}
	
	.install-btn:hover {
		background: var(--color-primary-hover);
		color: white;
	}
	
	.install-note {
		margin-top: 1rem;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
</style>