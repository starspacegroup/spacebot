<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();

	const status = $derived($page.status);
	const message = $derived($page.error?.message ?? tr('error.default'));

	const title = $derived(
		status === 404
			? tr('error.notFound.title')
			: status === 403
				? tr('error.forbidden.title')
				: status >= 500
					? tr('error.server.title')
					: tr('error.generic.title')
	);

	const blurb = $derived(
		status === 404
			? tr('error.notFound.blurb')
			: status === 403
				? tr('error.forbidden.blurb')
				: tr('error.generic.blurb')
	);
</script>

<svelte:head>
	<title>{status} · {title} — SpaceBot</title>
</svelte:head>

<div class="error-page">
	<div class="error-card" in:fly={{ y: 16, duration: 300 }}>
		<div class="error-code" aria-hidden="true">{status}</div>
		<h1 class="error-title">{title}</h1>
		<p class="error-blurb">{blurb}</p>
		{#if message && message !== title}
			<p class="error-detail">{message}</p>
		{/if}
		<div class="error-actions">
			<a href="/admin" class="btn btn-primary">{tr('error.backToDashboard')}</a>
			<a href="/" class="btn btn-secondary">{tr('error.goHome')}</a>
		</div>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem 1rem;
	}

	.error-card {
		max-width: 30rem;
		width: 100%;
		text-align: center;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		padding: 2.5rem 2rem;
		box-shadow: var(--shadow-lg);
	}

	.error-code {
		font-size: 4rem;
		font-weight: 800;
		line-height: 1;
		color: var(--color-primary);
		letter-spacing: -0.02em;
	}

	.error-title {
		margin: 1rem 0 0.5rem;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.error-blurb {
		margin: 0 0 0.75rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.error-detail {
		margin: 0 auto 1.5rem;
		max-width: 26rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		background: var(--color-code-bg);
		border-radius: var(--radius-sm, 4px);
		padding: 0.6rem 0.85rem;
		word-break: break-word;
	}

	.error-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		flex-wrap: wrap;
		margin-top: 1.5rem;
	}

	@media (max-width: 480px) {
		.error-actions {
			flex-direction: column;
		}
		.error-actions :global(.btn) {
			width: 100%;
		}
	}
</style>
