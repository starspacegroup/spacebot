<script lang="ts">
	export let title = 'Nothing here yet';
	export let body = 'Create the first item to get started.';
</script>

<div class="ui-empty">
	<strong>{title}</strong>
	<p>{body}</p>
	<slot />
</div>

<style>
	.ui-empty {
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		text-align: center;
		color: var(--color-text-secondary);
	}
	p {
		margin: 0.4rem 0 0;
		color: var(--color-text-muted);
	}
</style>
