<script lang="ts">
	const { data } = $props();
</script>

<svelte:head><title>SpaceBot Leaderboards</title></svelte:head>

<section class="leaderboard-page">
	<h1>Server leaderboards</h1>
	<p>
		Voice leaderboard entries are privacy-safe: only Discord IDs and aggregate time are shown.
	</p>
	{#if !data.guildId}
		<div class="empty">Add <code>?guild=SERVER_ID</code> to view a server leaderboard.</div>
	{:else if data.rows.length === 0}
		<div class="empty">No leaderboard data is available for this server yet.</div>
	{:else}
		<table>
			<thead><tr><th>Rank</th><th>User</th><th>Voice hours</th></tr></thead>
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
