<script lang="ts">
	import LogTable from '$lib/components/superadmin/LogTable.svelte';

	const { data } = $props();

	const TABS = [
		{ id: 'audit', label: 'Audit trail', note: 'Every change a signed-in person made.' },
		{
			id: 'activity',
			label: 'Activity',
			note: 'Commands run and events recorded, in every server.',
		},
		{
			id: 'errors',
			label: 'Errors',
			note: 'Failed commands, automations, syncs, bot errors and failed requests.',
		},
	];
	const RANGES = [
		[1, 'Last hour'],
		[24, 'Last day'],
		[168, 'Last 7 days'],
		[720, 'Last 30 days'],
	] as const;

	function link(over: Record<string, string | number | null>) {
		const p = new URLSearchParams();
		const merged: Record<string, string | number | null> = {
			tab: data.tab,
			guild: data.filter.guild,
			user: data.filter.user,
			hours: data.filter.hours,
			before: null,
			...over,
		};
		for (const [k, v] of Object.entries(merged))
			if (v !== null && v !== '') p.set(k, String(v));
		return `?${p.toString()}`;
	}
	const note = $derived(TABS.find((t) => t.id === data.tab)?.note);
</script>

<svelte:head><title>Logs · Superadmin</title></svelte:head>

<div class="page">
	<h1>Logs</h1>

	<div class="tabs">
		{#each TABS as t}
			<a class="tab" class:on={data.tab === t.id} href={link({ tab: t.id })}>{t.label}</a>
		{/each}
	</div>
	<p class="muted">{note}</p>

	<form method="GET" class="filters">
		<input type="hidden" name="tab" value={data.tab} />
		<label>
			Server
			<select name="guild">
				<option value="">All servers</option>
				{#each data.choices as c}
					<option value={c.id} selected={c.id === data.filter.guild}>{c.name}</option>
				{/each}
			</select>
		</label>
		<label>
			Person (user id)
			<input name="user" value={data.filter.user} placeholder="any" inputmode="numeric" />
		</label>
		<label>
			When
			<select name="hours">
				{#each RANGES as [h, name]}
					<option value={h} selected={Number(data.filter.hours) === h}>{name}</option>
				{/each}
			</select>
		</label>
		<button type="submit">Filter</button>
	</form>

	<div class="card">
		<LogTable rows={data.rows} servers={data.servers} empty="Nothing in this window." />
		{#if data.next}
			<p class="more"><a href={link({ before: data.next })}>Older →</a></p>
		{/if}
	</div>
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}
	h1 {
		margin: 0;
	}
	.muted {
		color: var(--color-text-muted);
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.tab {
		padding: 0.4rem 0.9rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		text-decoration: none;
		color: inherit;
	}
	.tab.on {
		background: var(--color-surface-elevated);
		border-color: var(--color-primary, #5865f2);
		font-weight: 600;
	}
	.filters {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: end;
	}
	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	input,
	select {
		font: inherit;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: inherit;
	}
	button {
		font: inherit;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: inherit;
		cursor: pointer;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.5rem 0.75rem;
	}
	.more {
		margin: 0.75rem 0.25rem;
	}
</style>
