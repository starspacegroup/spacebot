<script lang="ts">
	import { t } from '$lib/i18n.js';

	const { data } = $props();
</script>

<svelte:head><title>{t(data.locale, 'support.pageTitle')}</title></svelte:head>

<section class="link-page">
	<h1>{t(data.locale, 'public.support.title')}</h1>
	<p>{t(data.locale, 'support.body')}</p>
	{#if data.enabled}
		<a class="primary-action" href={data.url}>{t(data.locale, 'support.cta')}</a>
	{:else}
		<div class="disabled-state">
			{t(data.locale, 'support.disabled', { envName: data.envName })}
		</div>
	{/if}
</section>

<style>
	.link-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	h1 {
		font-size: 2.5rem;
		margin: 0 0 1rem;
	}
	.primary-action {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.8rem 1rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: white;
		text-decoration: none;
		font-weight: 700;
	}
	.disabled-state {
		margin-top: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
	}
</style>
