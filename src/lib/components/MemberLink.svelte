<script lang="ts">
	/**
	 * A member's name (or face) that opens everything the server knows about them.
	 * Use it anywhere a member shows up. It needs only the id; the server comes from the
	 * current admin page, or from `serverId` when used somewhere else.
	 */
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	const {
		id,
		serverId = '',
		label = '',
		children,
	}: {
		id: string | null | undefined;
		serverId?: string;
		label?: string;
		children: Snippet;
	} = $props();

	const server = $derived(serverId || page.params.serverId || '');
	const valid = $derived(Boolean(id && server && /^\d{5,20}$/.test(String(id))));
</script>

{#if valid}
	<a
		class="member-link"
		href="/admin/{server}/members/{id}"
		title={label ? `See everything about ${label}` : 'See everything about this member'}
		>{@render children()}</a
	>
{:else}
	{@render children()}
{/if}

<style>
	.member-link {
		color: inherit;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: inherit;
		min-width: 0;
	}
	.member-link:hover,
	.member-link:focus-visible {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
