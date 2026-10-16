<script lang="ts">
	/** A player's Discord avatar, or their first letter on a colour when there is none. */
	import { avatarColour, initial } from '$lib/activity/lcars.js';

	const { id, name, src = null } = $props<{ id: string; name: string; src?: string | null }>();
	let broken = $state(false);
</script>

<div class="av" style:--avc={avatarColour(id)} aria-hidden="true">
	{#if src && !broken}
		<img
			{src}
			alt=""
			loading="lazy"
			referrerpolicy="no-referrer"
			onerror={() => (broken = true)}
		/>
	{:else}
		<span>{initial(name)}</span>
	{/if}
</div>
