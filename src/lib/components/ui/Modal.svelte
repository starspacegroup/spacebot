<script lang="ts">
	export let open = false;
	export let title = 'Modal';
</script>

{#if open}
	<div class="ui-modal-backdrop" role="presentation">
		<div class="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
			<header>
				<h2>{title}</h2>
				<slot name="actions" />
			</header>
			<slot />
		</div>
	</div>
{/if}

<style>
	.ui-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		background: var(--color-overlay-scrim);
		padding: 1rem;
	}
	.ui-modal {
		width: min(560px, 100%);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: 1rem;
		box-shadow: var(--shadow-xl);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h2 {
		margin: 0 0 1rem;
	}
</style>
