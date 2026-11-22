<script lang="ts">
	const { data } = $props();

	const sections = $derived(
		[
			{
				key: 'logs',
				href: `/admin/${data.serverId}/logs`,
				title: 'Event logs',
				desc: 'See what happened in the server.',
			},
			{
				key: 'automations',
				href: `/admin/${data.serverId}/automations`,
				title: 'Automations',
				desc: 'Create and edit automated actions.',
			},
			{
				key: 'commands',
				href: `/admin/${data.serverId}/commands`,
				title: 'Commands',
				desc: 'Create and configure slash commands.',
			},
		].filter((s) => data.features[s.key])
	);
</script>

<svelte:head><title>Your access · {data.guild.name ?? 'Server'}</title></svelte:head>

<main class="access">
	<h1>{data.guild.name ?? 'This server'}</h1>
	<p class="lead">
		A role you hold here lets you in to part of the dashboard. Server settings, billing and the
		rest stay with the server's admins.
	</p>

	{#if sections.length > 0}
		<ul class="sections">
			{#each sections as s (s.key)}
				<li>
					<a class="card" href={s.href}>
						<strong>{s.title}</strong>
						<span>{s.desc}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">
			Your role lets you view this dashboard, but this server has not given it any sections
			yet. Ask an admin to pick a role for Event logs, Automations or Commands under Settings.
		</p>
	{/if}
</main>

<style>
	.access {
		max-width: 40rem;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	h1 {
		margin: 0 0 0.5rem;
	}
	.lead,
	.empty {
		color: var(--color-text-muted);
		margin: 0 0 1.5rem;
	}
	.sections {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	.card {
		display: grid;
		gap: 0.25rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: inherit;
		text-decoration: none;
	}
	.card:hover,
	.card:focus-visible {
		border-color: var(--color-primary);
	}
	.card span {
		color: var(--color-text-muted);
	}
</style>
