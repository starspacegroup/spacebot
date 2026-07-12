<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';

	const { data } = $props();
	const tr = getTranslator();

	// Build admin URL - use guild-specific if available
	const adminUrl = $derived(data.selectedGuildId ? `/admin/${data.selectedGuildId}` : '/admin');

	// Get error from URL if present
	const urlParams =
		typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
	const error = urlParams?.get('error');

	const KNOWN_ERRORS = ['no_code', 'invalid_state', 'config', 'auth_failed', 'access_denied'];
	const errorText = (code: string | null | undefined): string =>
		tr(code && KNOWN_ERRORS.includes(code) ? `login.errors.${code}` : 'login.errors.generic');
</script>

<div class="login-container">
	{#if error && data.isLoggedIn}
		<h1>{tr('login.cancelledTitle')}</h1>
		<p>{tr('login.cancelledBody')}</p>

		<div class="error-banner">
			{errorText(error)}
		</div>

		<div class="logged-in-card">
			<p class="logged-in-message">{tr('login.stillSignedIn')}</p>
			{#if data.isAdmin}
				<a href={adminUrl} class="dashboard-btn">{tr('common.goToDashboard')}</a>
			{:else}
				<a href="/" class="dashboard-btn">{tr('login.goHome')}</a>
			{/if}
		</div>
	{:else if error}
		<h1>{tr('login.title')}</h1>
		<p>{tr('login.subtitle')}</p>

		<div class="error-banner">
			{errorText(error)}
		</div>
	{:else}
		<h1>{tr('login.title')}</h1>
		<p>{tr('login.subtitle')}</p>
	{/if}

	{#if data.isLoggedIn && !error}
		<div class="logged-in-card">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" class="check-icon">
				<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
			</svg>
			<p class="logged-in-message">{tr('login.alreadySignedIn')}</p>
			{#if data.isAdmin}
				<a href={adminUrl} class="dashboard-btn">{tr('common.goToDashboard')}</a>
			{:else}
				<a href="/" class="dashboard-btn">{tr('login.goHome')}</a>
			{/if}
		</div>
	{:else if !data.isLoggedIn}
		<div class="login-card">
			<a
				href="/api/auth/discord{urlParams?.get('return_to')
					? '?return_to=' + encodeURIComponent(urlParams.get('return_to'))
					: ''}"
				class="discord-btn"
			>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path
						d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
					/>
				</svg>
				{tr('login.signInDiscord')}
			</a>

			{#if data.devAuthEnabled}
				<div class="dev-separator">
					<span>{tr('login.dev.or')}</span>
				</div>
				<div class="dev-btn-group">
					<a href="/dev-login?role=user" class="dev-btn">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"
							/>
						</svg>
						{tr('login.dev.user')}
					</a>
					<a href="/dev-login?role=admin" class="dev-btn">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 10h7c-.5 3.9-3.1 7.4-7 8.6V11H5V6.3l7-3.1V11z"
							/>
						</svg>
						{tr('login.dev.admin')}
					</a>
					<a href="/dev-login?role=superadmin" class="dev-btn">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="m5 16 3-9 4 3 4-3 3 9H5zm7-14 4 4-4 4-4-4 4-4zm-7 16h14v2H5v-2z"
							/>
						</svg>
						{tr('login.dev.superadmin')}
					</a>
				</div>
				<p class="dev-note">{tr('login.dev.note')}</p>
			{/if}

			<p class="info">{tr('login.afterSignin')}</p>
			<ul>
				<li>{tr('login.perk1')}</li>
				<li>{tr('login.perk2')}</li>
				<li>{tr('login.perk3')}</li>
			</ul>
		</div>
	{/if}

	{#if data.isLoggedIn && data.isAdmin && !error}
		<div class="install-card">
			<h2>{tr('login.install.title')}</h2>
			<p class="install-info">{tr('login.install.info')}</p>
			<a href="/api/auth/discord?flow=install" class="install-btn">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
				</svg>
				{tr('login.install.cta')}
			</a>
			<p class="install-note">{tr('login.install.note')}</p>
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
		background: var(--color-danger-soft);
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
		color: var(--color-success);
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
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		transition: background var(--transition-fast);
	}

	.dashboard-btn:hover {
		background: var(--color-primary-button-hover);
		color: var(--color-primary-button-text);
	}

	.discord-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2rem;
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1.1rem;
		transition: background var(--transition-fast);
	}

	.discord-btn:hover {
		background: var(--color-primary-button-hover);
		color: var(--color-primary-button-text);
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
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		transition: background var(--transition-fast);
	}

	.install-btn:hover {
		background: var(--color-primary-button-hover);
		color: var(--color-primary-button-text);
	}

	.install-note {
		margin-top: 1rem;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	/* Dev auth bypass styles */
	.dev-separator {
		display: flex;
		align-items: center;
		margin: 1.5rem 0;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.dev-separator::before,
	.dev-separator::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.dev-separator span {
		padding: 0 1rem;
	}

	.dev-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2rem;
		background: var(--color-warning);
		color: #1b1730;
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 1.1rem;
		transition:
			background var(--transition-fast),
			transform var(--transition-fast);
		border: 2px dashed var(--color-warning-hover);
	}

	.dev-btn-group {
		display: grid;
		gap: 0.75rem;
	}

	.dev-btn:hover {
		background: var(--color-warning-hover);
		color: #1b1730;
		transform: scale(1.02);
	}

	.dev-note {
		margin-top: 0.75rem;
		color: var(--color-warning);
		font-size: 0.8rem;
		font-weight: 500;
	}
</style>
