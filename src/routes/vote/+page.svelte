<script lang="ts">
	import { t } from '$lib/i18n.js';

	const { data } = $props();
</script>

<svelte:head><title>{t(data.locale, 'vote.pageTitle')}</title></svelte:head>

<section class="vote-page">
	<h1>{t(data.locale, 'public.vote.title')}</h1>
	<div class="actions">
		<div class="action-card">
			<h2>{t(data.locale, 'vote.vote')}</h2>
			{#if data.vote.enabled}
				<a href={data.vote.url}>{t(data.locale, 'vote.openVoting')}</a>
			{:else}
				<p>{t(data.locale, 'vote.enableVoting', { envName: data.vote.envName })}</p>
			{/if}
		</div>
		<div class="action-card">
			<h2>{t(data.locale, 'vote.review')}</h2>
			{#if data.review.enabled}
				<a href={data.review.url}>{t(data.locale, 'vote.openReview')}</a>
			{:else}
				<p>{t(data.locale, 'vote.enableReviews', { envName: data.review.envName })}</p>
			{/if}
		</div>
	</div>
</section>

<style>
	.vote-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	h1 {
		font-size: 2.5rem;
		margin: 0 0 1.5rem;
	}
	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem;
	}
	.action-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
		background: var(--color-surface);
	}
	.action-card a {
		color: var(--color-primary);
		font-weight: 700;
	}
</style>
