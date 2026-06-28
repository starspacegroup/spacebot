<script lang="ts">
	/** Optional heading shown at the top of the card. */
	export let title = '';
	/** Compact cards use tighter spacing for dense admin UI. */
	export let compact = false;
</script>

<section class="ui-card" class:compact>
	{#if title}<h3>{title}</h3>{/if}
	<slot />
</section>

<style>
	.ui-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 1rem;
	}
	.compact {
		padding: 0.75rem;
	}
	h3 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}
</style>
