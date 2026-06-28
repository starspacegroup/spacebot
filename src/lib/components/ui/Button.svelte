<script lang="ts">
	/** Button visual style. */
	export let variant: 'primary' | 'secondary' | 'danger' = 'primary';
	/** Button text when no child content is supplied. */
	export let label = 'Button';
	export let type: 'button' | 'submit' | 'reset' = 'button';
	export let disabled = false;
</script>

<button class="ui-button {variant}" {type} {disabled}>
	<slot>{label}</slot>
</button>

<style>
	.ui-button {
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		padding: 0.65rem 0.9rem;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.ui-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.primary {
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
	}
	.secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-border);
	}
	.danger {
		background: var(--color-danger);
		color: white;
	}
</style>
