<script lang="ts">
	export let label: string;
	export let value: string | number;
	export let delta = '';
</script>

<div class="ui-stat">
	<span>{label}</span>
	<strong>{value}</strong>
	{#if delta}<small>{delta}</small>{/if}
</div>

<style>
	.ui-stat {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 1rem;
	}
	span {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	strong {
		display: block;
		margin-top: 0.25rem;
		font-size: 1.8rem;
	}
	small {
		color: var(--color-success);
	}
</style>
