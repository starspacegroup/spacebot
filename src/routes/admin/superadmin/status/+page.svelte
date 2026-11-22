<script lang="ts">
	import { enhance } from '$app/forms';

	const { data, form } = $props();
	const snap = $derived(data.snapshot);

	const STAGE: Record<string, string> = {
		investigating: 'Investigating',
		identified: 'Identified',
		monitoring: 'Monitoring',
		resolved: 'Resolved',
	};
	const IMPACT: Record<string, string> = {
		minor: 'Minor',
		major: 'Major',
		critical: 'Critical',
		maintenance: 'Maintenance (planned)',
	};

	function when(sql: string | null | undefined) {
		if (!sql) return '';
		const d = new Date(sql.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString('en-GB', {
					timeZone: 'UTC',
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false,
				}) + ' UTC';
	}
	const nameOf = (id: string) => data.components.find((c) => c.id === id)?.name ?? id;
</script>

<svelte:head><title>Status page · Superadmin</title></svelte:head>

<div class="sa-status">
	<h1>Status page</h1>
	<p class="muted">
		What people see at <a href="/status" target="_blank" rel="noopener">/status</a>. The checks
		open and close their own incidents; use this page to post one yourself (a planned move, a
		cause, a fix) or to add an update to any open incident.
	</p>

	{#if form?.error}
		<p class="err" role="alert">{form.error}</p>
	{/if}
	{#if form?.created}
		<p class="ok" role="status">Incident posted.</p>
	{/if}

	{#if snap}
		<section class="card">
			<h2>Now</h2>
			<ul class="now">
				{#each snap.components as c, i (i)}
					<li>
						<span class="dot s-{c.status}" aria-hidden="true"></span>
						<strong>{c.name}</strong>
						<span class="muted">
							{c.status === 'operational'
								? 'Operational'
								: c.status === 'degraded'
									? 'Slow'
									: 'Down'}
							{#if c.detail}· {c.detail}{/if}
						</span>
					</li>
				{/each}
			</ul>
			{#if snap.stale}
				<p class="warn">
					Checks are not arriving. The public page is saying "Status checks are delayed".
					The orchestrator worker posts them every minute.
				</p>
			{/if}
		</section>
	{/if}

	<section class="card">
		<h2>Post an incident</h2>
		<form method="POST" action="?/create" use:enhance class="stack">
			<label>
				Title
				<input
					name="title"
					maxlength="120"
					required
					placeholder="Moving the bot to a new server"
				/>
			</label>
			<div class="row">
				<label>
					Impact
					<select name="impact">
						{#each data.impacts as v (v)}
							<option value={v}>{IMPACT[v]}</option>
						{/each}
					</select>
				</label>
				<label>
					Stage
					<select name="status">
						{#each data.statuses as v (v)}
							<option value={v}>{STAGE[v]}</option>
						{/each}
					</select>
				</label>
			</div>
			<fieldset>
				<legend>Affects</legend>
				{#each data.components as c (c.id)}
					<label class="check"
						><input type="checkbox" name="components" value={c.id} /> {c.name}</label
					>
				{/each}
			</fieldset>
			<label>
				What people should know
				<textarea
					name="message"
					rows="4"
					maxlength="2000"
					placeholder="We are looking into it."></textarea>
			</label>
			<p class="muted small">This is public as soon as you post. Plain text only.</p>
			<button type="submit">Post incident</button>
		</form>
	</section>

	<section class="card">
		<h2>Open incidents</h2>
		{#if !snap || snap.openIncidents.length === 0}
			<p class="muted">None.</p>
		{:else}
			{#each snap.openIncidents as inc, i (i)}
				<article class="inc">
					<h3>
						{inc.title}
						<span class="pill">{IMPACT[inc.impact]}</span>
						<span class="pill">{STAGE[inc.status]}</span>
						{#if inc.auto}<span class="pill">opened by the checks</span>{/if}
					</h3>
					<p class="muted small">
						Started {when(inc.startedAt)}
						{#if inc.components.length}· {inc.components.map(nameOf).join(', ')}{/if}
					</p>
					<ol class="updates">
						{#each inc.updates as u, j (j)}
							<li>
								<span class="muted small">
									<strong>{STAGE[u.status]}</strong> · {when(u.createdAt)}
									{#if !u.byPerson}· checks{/if}
								</span>
								<p>{u.body}</p>
							</li>
						{/each}
					</ol>
					<form method="POST" action="?/update" use:enhance class="stack update">
						<input type="hidden" name="incident_id" value={inc.id} />
						<div class="row">
							<label>
								Stage
								<select name="status">
									{#each data.statuses as v (v)}
										<option value={v} selected={v === inc.status}
											>{STAGE[v]}</option
										>
									{/each}
								</select>
							</label>
						</div>
						<label>
							Update
							<textarea name="message" rows="2" maxlength="2000" required></textarea>
						</label>
						{#if form?.incident === inc.id && form?.error}
							<p class="err" role="alert">{form.error}</p>
						{/if}
						<button type="submit">Post update</button>
					</form>
				</article>
			{/each}
		{/if}
	</section>

	<section class="card">
		<h2>Recently resolved</h2>
		{#if !snap || snap.recentIncidents.length === 0}
			<p class="muted">None in the last 30 days.</p>
		{:else}
			<ul class="plain">
				{#each snap.recentIncidents as inc, i (i)}
					<li>
						<strong>{inc.title}</strong>
						<span class="muted small">
							{when(inc.startedAt)} to {when(inc.resolvedAt)}{inc.auto
								? ' · opened by the checks'
								: ''}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.sa-status {
		max-width: 820px;
		display: grid;
		gap: 1.25rem;
	}
	h1 {
		margin: 0;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
	}
	.muted {
		color: var(--color-text-muted);
	}
	.small {
		font-size: 0.85rem;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.15rem;
	}
	.stack {
		display: grid;
		gap: 0.75rem;
	}
	.row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.check {
		display: inline-flex;
		grid-auto-flow: column;
		align-items: center;
		gap: 0.4rem;
		margin-right: 1rem;
	}
	fieldset {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
	}
	input:not([type='checkbox']),
	select,
	textarea {
		font: inherit;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-elevated);
		color: inherit;
	}
	button {
		justify-self: start;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		border: none;
		background: var(--color-primary);
		color: var(--color-primary-button-text);
		font: inherit;
		cursor: pointer;
	}
	.now,
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.dot {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		margin-right: 0.4rem;
		background: var(--color-border);
	}
	.s-operational {
		background: var(--color-success);
	}
	.s-degraded {
		background: var(--color-warning);
	}
	.s-down {
		background: var(--color-danger);
	}
	.inc {
		border-top: 1px solid var(--color-border);
		padding-top: 0.9rem;
		margin-top: 0.9rem;
	}
	.inc:first-of-type {
		border-top: none;
		margin-top: 0;
	}
	.inc h3 {
		margin: 0;
		font-size: 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.pill {
		font-size: 0.72rem;
		font-weight: 400;
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		color: var(--color-text-muted);
	}
	.updates {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
		display: grid;
		gap: 0.5rem;
	}
	.updates p {
		margin: 0.1rem 0 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.update {
		background: var(--color-surface-elevated);
		border-radius: var(--radius-md);
		padding: 0.75rem;
	}
	.err {
		color: var(--color-danger);
	}
	.ok {
		color: var(--color-success);
	}
	.warn {
		color: var(--color-warning);
	}
</style>
