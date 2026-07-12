<script lang="ts">
	import { getTranslator } from '$lib/i18n.js';

	const { data } = $props();
	const profile = $derived(data.profile);
	const tr = getTranslator();
</script>

<svelte:head><title>{tr('profile.metaTitle', { name: profile.display_name })}</title></svelte:head>

<section class="profile-page">
	<h1>{profile.display_name}</h1>
	<p>{profile.bio || tr('profile.noBio')}</p>
	<div class="badges">
		{#each profile.badges as badge}
			<span>{badge}</span>
		{/each}
	</div>
	<dl>
		<div>
			<dt>{tr('profile.commandsUsed')}</dt>
			<dd>{profile.stats.command_count ?? tr('profile.private')}</dd>
		</div>
		<div>
			<dt>{tr('profile.voiceSeconds')}</dt>
			<dd>{profile.stats.voice_seconds ?? tr('profile.private')}</dd>
		</div>
	</dl>
</section>

<style>
	.profile-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	h1 {
		font-size: 2.5rem;
		margin: 0 0 1rem;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}
	.badges span {
		border-radius: var(--radius-full);
		background: var(--color-primary-soft);
		color: var(--color-primary);
		padding: 0.35rem 0.6rem;
		font-weight: 700;
	}
	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
	}
	dl div {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0.25rem 0 0;
		font-size: 1.5rem;
		font-weight: 800;
	}
</style>
