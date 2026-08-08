<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';
	import TrustedHtml from '$lib/components/TrustedHtml.svelte';

	const { data } = $props();
	const tr = getTranslator();

	// Build admin URL - use guild-specific if available
	const adminUrl = $derived(data.selectedGuildId ? `/admin/${data.selectedGuildId}` : '/admin');
</script>

<div class="add-server-container">
	<div class="add-server-card">
		<div class="icon-container">
			<svg width="64" height="64" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M12 8V16M8 12H16"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</div>

		<h1>{tr('addServer.title')}</h1>

		<p class="description">{tr('addServer.description')}</p>

		{#if data.user}
			{#if data.inviteUrl}
				<a href={data.inviteUrl} class="btn btn-primary btn-large">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
						<path
							d="M12 5V19M5 12H19"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					{tr('addServer.cta')}
				</a>

				<p class="hint"><TrustedHtml html={tr('addServer.hint')} /></p>
			{:else}
				<div class="alert alert-error">
					<p>{tr('addServer.errorTitle')}</p>
					<p>{tr('addServer.errorBody')}</p>
				</div>
			{/if}
		{:else}
			<p class="login-prompt"><TrustedHtml html={tr('addServer.loginPrompt')} /></p>
		{/if}

		<a href={adminUrl} class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
				<path
					d="M19 12H5M5 12L12 19M5 12L12 5"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			{tr('addServer.backToAdmin')}
		</a>
	</div>
</div>

<style>
	.add-server-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: calc(100vh - 60px);
		padding: 2rem 1rem;
	}

	.add-server-card {
		max-width: 480px;
		width: 100%;
		padding: 2.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.icon-container {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 80px;
		height: 80px;
		margin-bottom: 1.5rem;
		border-radius: 50%;
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.description {
		margin: 0 0 1.5rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.hint {
		margin: 1.5rem 0;
		padding: 1rem;
		background: var(--color-surface-elevated);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.hint strong {
		color: var(--color-text);
	}

	.alert {
		padding: 1rem;
		border-radius: var(--radius-sm);
		margin: 1rem 0;
	}

	.alert-error {
		background: var(--color-danger-soft);
		border: 1px solid rgba(237, 66, 69, 0.3);
		color: var(--color-danger);
	}

	.alert p {
		margin: 0.25rem 0;
	}

	.login-prompt {
		margin: 1rem 0;
		color: var(--color-text-muted);
	}

	.login-prompt a {
		color: var(--color-primary);
		font-weight: 500;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
		padding: 0.5rem 1rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.back-link:hover {
		color: var(--color-text);
	}
</style>
