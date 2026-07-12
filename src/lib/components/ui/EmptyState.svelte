<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();

	export let title = tr('ui.emptyState.title');
	export let body = tr('ui.emptyState.body');
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
