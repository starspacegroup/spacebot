<script lang="ts">
	export let label: string;
	export let name: string;
	export let value = '';
	export let hint = '';
	export let placeholder = '';
</script>

<label class="ui-field" for={name}>
	<span>{label}</span>
	<input id={name} {name} bind:value {placeholder} />
	{#if hint}<small>{hint}</small>{/if}
</label>

<style>
	.ui-field {
		display: grid;
		gap: 0.4rem;
		color: var(--color-text);
	}
	.ui-field span {
		font-weight: 700;
	}
	input {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		padding: 0.65rem 0.75rem;
	}
	small {
		color: var(--color-text-muted);
	}
</style>
