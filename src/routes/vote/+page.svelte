<script lang="ts">
	const { data } = $props();
</script>

<svelte:head><title>Vote for SpaceBot</title></svelte:head>

<section class="vote-page">
	<h1>Vote and reviews</h1>
	<div class="actions">
		<div class="action-card">
			<h2>Vote</h2>
			{#if data.vote.enabled}
				<a href={data.vote.url}>Open voting page</a>
			{:else}
				<p>Set {data.vote.envName} to enable voting.</p>
			{/if}
		</div>
		<div class="action-card">
			<h2>Review</h2>
			{#if data.review.enabled}
				<a href={data.review.url}>Open review page</a>
			{:else}
				<p>Set {data.review.envName} to enable reviews.</p>
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
