<script lang="ts">
	const { html }: { html: string } = $props();
</script>

<!-- Only repository-controlled markup belongs here. Render dynamic values normally. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html html}
