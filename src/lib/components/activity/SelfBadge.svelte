<script lang="ts">
	/** The viewer's own badge, bottom right, in the colour of their state. */
	import Avatar from './Avatar.svelte';

	const {
		id,
		name,
		avatar = null,
		status,
		colour,
	}: {
		id: string;
		name: string;
		avatar?: string | null;
		status: string;
		colour: string;
	} = $props();
</script>

<div class="self" style:--selfc={colour} aria-label="You: {name}, {status}">
	<Avatar {id} {name} src={avatar} />
	<div class="who">
		<div class="k">You</div>
		<div class="n">{name}</div>
		<div class="t">{status}</div>
	</div>
</div>
