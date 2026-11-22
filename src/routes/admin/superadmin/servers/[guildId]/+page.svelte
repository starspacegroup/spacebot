<script lang="ts">
	import LogTable from '$lib/components/superadmin/LogTable.svelte';

	const { data } = $props();
	const g = $derived(data.guild);
	const STANDING: Record<string, string> = {
		owner: 'Owner',
		admin: 'Administrator',
		manager: 'Manage Server',
		member: 'Member',
	};
	const RANGES = [
		[24, 'Last day'],
		[168, 'Last 7 days'],
		[720, 'Last 30 days'],
	] as const;
	const none: Record<string, string> = {};
</script>

<svelte:head><title>{g.name} · Superadmin</title></svelte:head>

<div class="page">
	<p class="crumb"><a href="/admin/superadmin/servers">← Servers</a></p>
	<header>
		<h1>{g.name}</h1>
		<p class="muted">
			id {g.id}{#if g.members}
				· about {g.members.toLocaleString()} members{/if} · plan {data.plan.name}
		</p>
		<p class="muted">
			Owner:
			{#if g.ownerId}
				<a href={`/admin/superadmin/users/${g.ownerId}`}>{g.ownerName ?? g.ownerId}</a>
			{:else}unknown{/if}
		</p>
		<p class="muted">
			{data.commands.active} of {data.commands.total} commands on · {data.automations.active} of
			{data.automations.total} automations on
		</p>
		{#if data.sync?.last_error}
			<p class="warn">
				Last command sync failed ({data.sync.attempted_at} UTC): {data.sync.last_error}
			</p>
		{:else if data.sync?.synced_at}
			<p class="muted">Commands synced {data.sync.synced_at} UTC</p>
		{/if}
		<p><a href={`/admin/${g.id}`}>Open its dashboard →</a></p>
	</header>

	<section class="card">
		<h2>People ({data.people.length})</h2>
		{#if data.people.length === 0}
			<p class="muted">Nobody recorded yet. People are saved when they open the dashboard.</p>
		{:else}
			<ul class="list">
				{#each data.people as p}
					<li>
						<a href={`/admin/superadmin/users/${p.user_id}`}
							>{p.global_name || p.username || p.user_id}</a
						>
						<span class="badge {p.standing}">{STANDING[p.standing]}</span>
						{#if p.banned}<span class="badge">banned</span>{/if}
						<span class="muted small">last seen {p.seen_at} UTC</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<div class="range">
		{#each RANGES as [h, name]}
			<a class:on={data.hours === h} href={`?hours=${h}`}>{name}</a>
		{/each}
	</div>

	{#if data.errors.length}
		<section class="card">
			<h2>Errors</h2>
			<LogTable rows={data.errors} servers={none} showServer={false} />
		</section>
	{/if}

	<section class="card">
		<h2>Activity</h2>
		<LogTable
			rows={data.activity}
			servers={none}
			showServer={false}
			empty="Nothing in this window."
		/>
	</section>

	<section class="card">
		<h2>Changes</h2>
		<LogTable
			rows={data.audit}
			servers={none}
			showServer={false}
			empty="No changes in this window."
		/>
		<p class="muted small">
			More: <a href={`/admin/superadmin/logs?tab=audit&guild=${g.id}`}>audit trail</a> ·
			<a href={`/admin/superadmin/logs?tab=errors&guild=${g.id}`}>errors</a>
		</p>
	</section>
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h2 {
		font-size: 1.05rem;
		margin-bottom: 0.5rem;
	}
	.muted {
		color: var(--color-text-muted);
	}
	.small {
		font-size: 0.82rem;
	}
	.warn {
		color: var(--color-error, #e5484d);
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.75rem 1rem;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.badge {
		font-size: 0.72rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		margin: 0 0.4rem;
	}
	.badge.owner {
		border-color: gold;
	}
	.range {
		display: flex;
		gap: 0.5rem;
	}
	.range a {
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: inherit;
	}
	.range a.on {
		background: var(--color-surface-elevated);
		font-weight: 600;
	}
</style>
