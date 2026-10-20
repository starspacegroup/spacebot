<script lang="ts">
	/**
	 * One player in the roster: avatar, name and a status line. A button when it
	 * can be picked (a vote), a plain card otherwise.
	 */
	import Avatar from './Avatar.svelte';

	const {
		id,
		name,
		avatar = null,
		status = '',
		icon = '',
		variant = '',
		onpick = null,
		pressed = false,
		disabled = false,
	}: {
		id: string;
		name: string;
		avatar?: string | null;
		status?: string;
		icon?: string;
		/** Space-separated: out, away, dimv, pick, agent, host. */
		variant?: string;
		onpick?: null | (() => void);
		pressed?: boolean;
		disabled?: boolean;
	} = $props();
</script>

{#if onpick}
	<button
		type="button"
		class="pc {variant}"
		aria-pressed={pressed}
		{disabled}
		onclick={() => onpick?.()}
	>
		<Avatar {id} {name} src={avatar} />
		<div class="who">
			<div class="nm">{name}</div>
			<div class="ss">{status}</div>
		</div>
		{#if icon}<div class="ic" aria-hidden="true">{icon}</div>{/if}
	</button>
{:else}
	<div class="pc {variant}">
		<Avatar {id} {name} src={avatar} />
		<div class="who">
			<div class="nm">{name}</div>
			<div class="ss">{status}</div>
		</div>
		{#if icon}<div class="ic" aria-hidden="true">{icon}</div>{/if}
	</div>
{/if}
