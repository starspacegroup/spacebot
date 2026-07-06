<script lang="ts">
	import { t } from '$lib/i18n.js';

	const { data } = $props();
</script>

<svelte:head><title>{t(data.locale, 'leaderboards.pageTitle')}</title></svelte:head>

<section class="leaderboard-page">
	<h1>{t(data.locale, 'leaderboards.title')}</h1>
	<p>{t(data.locale, 'leaderboards.body')}</p>
	{#if !data.guildId}
		<div class="empty">
			{t(data.locale, 'leaderboards.needGuildBefore')}
			<code>?guild=SERVER_ID</code>
			{t(data.locale, 'leaderboards.needGuildAfter')}
		</div>
	{:else if data.rows.length === 0}
		<div class="empty">{t(data.locale, 'leaderboards.empty')}</div>
	{:else}
		<table>
			<thead
				><tr
					><th>{t(data.locale, 'leaderboards.rank')}</th><th
						>{t(data.locale, 'leaderboards.user')}</th
					><th>{t(data.locale, 'leaderboards.voiceHours')}</th></tr
				></thead
			>
			<tbody>
				{#each data.rows as row, index}
					<tr>
						<td>{index + 1}</td>
						<td>{row.user_id}</td>
						<td>{Math.round(Number(row.voice_seconds || 0) / 360) / 10}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.leaderboard-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 1.5rem;
	}
	th,
	td {
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		padding: 0.75rem;
	}
	.empty {
		margin-top: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 1rem;
	}
</style>
