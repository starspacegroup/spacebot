<script lang="ts">
	import LogTable from '$lib/components/superadmin/LogTable.svelte';

	const { data } = $props();
	const p = $derived(data.person);
	const RANGES = [
		[24, 'Last day'],
		[168, 'Last 7 days'],
		[720, 'Last 30 days'],
	] as const;
	const STANDING: Record<string, string> = {
		owner: 'Owner',
		admin: 'Administrator',
		manager: 'Manage Server',
		member: 'Member',
	};
</script>

<svelte:head><title>{p.global_name || p.username} · Superadmin</title></svelte:head>

<div class="page">
	<p class="crumb"><a href="/admin/superadmin/users">← Users</a></p>
	<header>
		<h1>{p.global_name || p.username}</h1>
		<p class="muted">
			@{p.username} · id {p.id}
			{#if p.is_superadmin}· superadmin{/if}
			{#if p.banned}· <strong>banned</strong>{/if}
		</p>
		<p class="muted">
			{p.login_count ?? 0} sign-ins{#if p.last_login_at}, last {p.last_login_at} UTC{/if}
		</p>
		{#if p.notes}<p class="note">{p.notes}</p>{/if}
	</header>

	<section class="card">
		<h2>Servers ({data.servers.length})</h2>
		{#if data.servers.length === 0}
			<p class="muted">
				None recorded yet. A person's servers are saved when they open the dashboard, for
				servers the bot is in.
			</p>
		{:else}
			<ul class="list">
				{#each data.servers as s}
					<li>
						<a href={`/admin/superadmin/servers/${s.guild_id}`}
							>{s.name ?? s.guild_id}</a
						>
						<span class="badge {s.standing}">{STANDING[s.standing]}</span>
						<span class="muted small">last seen {s.seen_at} UTC</span>
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
			<LogTable rows={data.errors} servers={data.names} showUser={false} />
		</section>
	{/if}

	<section class="card">
		<h2>Timeline</h2>
		<LogTable
			rows={data.timeline}
			servers={data.names}
			showUser={false}
			empty="Nothing in this window."
		/>
		<p class="muted small">
			Full list with filters: <a href={`/admin/superadmin/logs?tab=audit&user=${p.id}`}
				>audit trail</a
			>
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
	.note {
		margin-top: 0.4rem;
		padding: 0.5rem 0.7rem;
		border-left: 3px solid var(--color-border);
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
