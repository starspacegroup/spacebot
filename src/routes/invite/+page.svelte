<script lang="ts">
	const { data } = $props();
</script>

<svelte:head><title>Invite SpaceBot</title></svelte:head>

<section class="public-action">
	<div>
		<p class="eyebrow">Discord install</p>
		<h1>Invite SpaceBot</h1>
		<p>
			Install the bot with slash commands, context menus, automations, and analytics enabled.
		</p>
		{#if data.inviteUrl}
			<a class="primary-action" href={data.inviteUrl}>Open Discord install</a>
		{:else}
			<div class="disabled-state">
				<strong>Invite link disabled</strong>
				<span>Set DISCORD_CLIENT_ID to enable the public install CTA.</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.public-action {
		max-width: 880px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	.eyebrow {
		color: var(--color-primary);
		font-weight: 700;
		text-transform: uppercase;
	}
	h1 {
		font-size: 3rem;
		margin: 0 0 1rem;
	}
	.primary-action {
		display: inline-block;
		margin-top: 1.5rem;
		padding: 0.85rem 1rem;
		border-radius: var(--radius-md);
		background: var(--color-primary-button);
		color: var(--color-primary-button-text);
		text-decoration: none;
		font-weight: 700;
	}
	.disabled-state {
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		display: grid;
		gap: 0.35rem;
	}
</style>
