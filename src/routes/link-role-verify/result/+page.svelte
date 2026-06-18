<script lang="ts">
	const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
	const success = urlParams?.get('success') === 'true';
	const error = urlParams?.get('error');

	const errorMessages = {
		'denied': 'You cancelled the authorization. You can try again from Discord.',
		'no_code': 'Authorization failed - no code received.',
		'invalid_state': 'Session expired. Please try again from Discord.',
		'config': 'Server configuration error. Please contact an administrator.',
		'token_failed': 'Failed to exchange authorization code. Please try again.',
		'metadata_failed': 'Failed to update your role connection. Please try again.',
		'unexpected': 'An unexpected error occurred. Please try again.',
	};
</script>

<svelte:head>
	<title>SpaceBot - Linked Role Verification</title>
</svelte:head>

<div class="container">
	<div class="card">
		{#if success}
			<div class="icon success-icon">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
					<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
				</svg>
			</div>
			<h1>Linked Role Connected!</h1>
			<p>Your account has been verified with SpaceBot. You can now close this window and return to Discord.</p>
			<p class="hint">The linked role should appear on your profile automatically.</p>
		{:else if error}
			<div class="icon error-icon">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
				</svg>
			</div>
			<h1>Verification Failed</h1>
			<p>{errorMessages[error] || 'An unknown error occurred.'}</p>
			<p class="hint">Please try linking your role again from Discord's server settings.</p>
		{:else}
			<div class="icon">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
				</svg>
			</div>
			<h1>SpaceBot Verification</h1>
			<p>Redirecting to Discord for authorization...</p>
		{/if}
	</div>
</div>

<style>
	.container {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 100vh;
		padding: 1rem;
		background: var(--color-bg, #0a0a0a);
	}

	.card {
		background: var(--color-surface, #1a1a2e);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 12px;
		padding: 3rem 2rem;
		max-width: 480px;
		width: 100%;
		text-align: center;
	}

	h1 {
		color: var(--color-text, #e0e0e0);
		margin: 1rem 0 0.5rem;
		font-size: 1.5rem;
	}

	p {
		color: var(--color-text-secondary, #a0a0b0);
		line-height: 1.6;
		margin: 0.5rem 0;
	}

	.hint {
		font-size: 0.875rem;
		color: var(--color-text-muted, #707080);
		margin-top: 1rem;
	}

	.icon {
		display: flex;
		justify-content: center;
	}

	.success-icon {
		color: #43b581;
	}

	.error-icon {
		color: #f04747;
	}
</style>
