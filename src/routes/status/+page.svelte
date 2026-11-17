<script lang="ts">
	const { data } = $props();
	const snap = $derived(data.snapshot);

	const LABEL: Record<string, string> = {
		operational: 'Operational',
		degraded: 'Slow',
		down: 'Down',
	};
	const MARK: Record<string, string> = { operational: '✓', degraded: '!', down: '✕' };
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
		maintenance: 'Maintenance',
	};

	/** SQL UTC time → "17 Nov, 12:05 UTC". Always UTC so the server and the browser agree. */
	function when(sql: string | null | undefined) {
		if (!sql) return '';
		const d = new Date(sql.replace(' ', 'T') + 'Z');
		if (Number.isNaN(d.getTime())) return '';
		return (
			d.toLocaleString('en-GB', {
				timeZone: 'UTC',
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			}) + ' UTC'
		);
	}

	function dayText(day: string, level: string) {
		const what =
			level === 'none'
				? 'no data'
				: level === 'operational'
					? 'no problems'
					: level === 'degraded'
						? 'some problems'
						: 'an outage';
		return `${day}: ${what}`;
	}

	const nameOf = (id: string) => snap?.components.find((c) => c.id === id)?.name ?? id;
	const tone = $derived(snap?.stale ? 'stale' : (snap?.overall ?? 'stale'));
</script>

<svelte:head>
	<title>SpaceBot Status</title>
	<link rel="alternate" type="application/json" href="/api/status" title="Status feed" />
</svelte:head>

<main class="status-page">
	<header class="intro">
		<h1>SpaceBot Status</h1>
		<p class="lede">
			Live checks of the website, the database and the bot. The checks run every minute.
		</p>
	</header>

	{#if !snap}
		<section class="banner tone-stale" aria-live="polite">
			<span class="mark" aria-hidden="true">?</span>
			<div>
				<h2>Status is not available right now</h2>
				<p>
					We could not read the status data. This is not an all-clear. Try again in a
					minute.
				</p>
			</div>
		</section>
	{:else}
		<section class="banner tone-{tone}" aria-live="polite">
			<span class="mark" aria-hidden="true">
				{snap.stale ? '?' : MARK[snap.overall]}
			</span>
			<div>
				<h2>{snap.headline}</h2>
				{#if snap.stale}
					<p>
						The newest check is
						{#if snap.lastChecked}from {when(snap.lastChecked)}{:else}missing{/if}. We
						will not say all is well until checks resume.
					</p>
				{:else}
					<p>Last checked {when(snap.lastChecked)}.</p>
				{/if}
			</div>
		</section>

		{#if snap.openIncidents.length}
			<section class="block" aria-labelledby="open-h">
				<h2 id="open-h">Open incidents</h2>
				{#each snap.openIncidents as inc, i (i)}
					<article class="incident open impact-{inc.impact}">
						<header>
							<h3>{inc.title}</h3>
							<span class="pill">{IMPACT[inc.impact]}</span>
							<span class="pill stage">{STAGE[inc.status]}</span>
						</header>
						<p class="meta">
							Started {when(inc.startedAt)}
							{#if inc.components.length}· Affects {inc.components
									.map(nameOf)
									.join(', ')}{/if}
						</p>
						<ol class="updates">
							{#each inc.updates as u, j (j)}
								<li>
									<span class="u-head"
										><strong>{STAGE[u.status]}</strong> · {when(
											u.createdAt
										)}</span
									>
									<p>{u.body}</p>
								</li>
							{/each}
						</ol>
					</article>
				{/each}
			</section>
		{/if}

		<section class="block" aria-labelledby="comp-h">
			<h2 id="comp-h">Systems</h2>
			<ul class="components">
				{#each snap.components as c, i (i)}
					<li class="component">
						<div class="c-top">
							<div class="c-name">
								<h3>{c.name}</h3>
								<p class="desc">{c.description}</p>
							</div>
							<div class="c-state state-{c.status}">
								<span class="mark" aria-hidden="true">{MARK[c.status]}</span>
								<span>{LABEL[c.status]}</span>
							</div>
						</div>
						{#if c.status !== 'operational' && c.detail}
							<p class="why">{c.detail}</p>
						{/if}
						<div
							class="bars"
							role="img"
							aria-label="Last 90 days. {c.uptimePercent === null
								? 'No history yet.'
								: `${c.uptimePercent}% uptime.`}"
						>
							{#each c.days as d, k (k)}
								<span class="bar lvl-{d.level}" title={dayText(d.day, d.level)}
								></span>
							{/each}
						</div>
						<div class="bar-legend">
							<span>90 days ago</span>
							<span>
								{#if c.uptimePercent === null}
									No history yet
								{:else}
									{c.uptimePercent}% uptime
								{/if}
							</span>
							<span>Today</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>

		<section class="block" aria-labelledby="past-h">
			<h2 id="past-h">Past incidents</h2>
			<p class="muted">The last 30 days.</p>
			{#if snap.recentIncidents.length === 0}
				<p class="empty">No incidents in the last 30 days.</p>
			{:else}
				{#each snap.recentIncidents as inc, i (i)}
					<article class="incident impact-{inc.impact}">
						<header>
							<h3>{inc.title}</h3>
							<span class="pill">{IMPACT[inc.impact]}</span>
							<span class="pill stage">Resolved</span>
						</header>
						<p class="meta">
							{when(inc.startedAt)} to {when(inc.resolvedAt)}
							{#if inc.components.length}· {inc.components
									.map(nameOf)
									.join(', ')}{/if}
						</p>
						<ol class="updates">
							{#each inc.updates as u, j (j)}
								<li>
									<span class="u-head"
										><strong>{STAGE[u.status]}</strong> · {when(
											u.createdAt
										)}</span
									>
									<p>{u.body}</p>
								</li>
							{/each}
						</ol>
					</article>
				{/each}
			{/if}
		</section>
	{/if}

	<footer class="foot">
		<p>
			Times are UTC. Machine-readable feed: <a href="/api/status">/api/status</a>.
		</p>
	</footer>
</main>

<style>
	.status-page {
		max-width: 860px;
		margin: 0 auto;
		padding: 2.5rem 1rem 4rem;
	}
	.intro h1 {
		margin: 0 0 0.25rem;
	}
	.lede,
	.muted,
	.desc,
	.meta,
	.bar-legend,
	.foot {
		color: var(--color-text-muted);
	}
	.lede {
		margin: 0 0 1.5rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0 0 0.75rem;
	}

	.banner {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 1.1rem 1.25rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		margin-bottom: 2rem;
	}
	.banner h2 {
		margin: 0 0 0.15rem;
		font-size: 1.25rem;
	}
	.banner p {
		margin: 0;
		color: var(--color-text-muted);
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		font-weight: 700;
		flex: none;
		background: var(--color-surface-elevated);
		border: 2px solid currentColor;
	}
	.tone-operational {
		border-color: var(--color-success);
	}
	.tone-operational .mark {
		color: var(--color-success);
	}
	.tone-degraded {
		border-color: var(--color-warning);
	}
	.tone-degraded .mark {
		color: var(--color-warning);
	}
	.tone-down {
		border-color: var(--color-danger);
	}
	.tone-down .mark {
		color: var(--color-danger);
	}
	.tone-stale {
		border-color: var(--color-border);
	}

	.block {
		margin-bottom: 2.25rem;
	}
	.components {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	.component {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.1rem;
	}
	.c-top {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}
	.c-name h3 {
		margin: 0;
		font-size: 1rem;
	}
	.desc {
		margin: 0.15rem 0 0;
		font-size: 0.875rem;
	}
	.c-state {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.c-state .mark {
		width: 1.4rem;
		height: 1.4rem;
		font-size: 0.8rem;
	}
	.state-operational {
		color: var(--color-success-text);
	}
	.state-degraded {
		color: var(--color-warning-text);
	}
	.state-down {
		color: var(--color-danger-text);
	}
	.why {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
	}

	.bars {
		display: grid;
		grid-template-columns: repeat(90, 1fr);
		gap: 2px;
		margin-top: 0.85rem;
		height: 2rem;
	}
	.bar {
		border-radius: 2px;
		background: var(--color-border);
	}
	.lvl-operational {
		background: var(--color-success);
	}
	.lvl-degraded {
		background: var(--color-warning);
	}
	.lvl-down {
		background: var(--color-danger);
	}
	.bar-legend {
		display: flex;
		justify-content: space-between;
		font-size: 0.78rem;
		margin-top: 0.3rem;
	}

	.incident {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left-width: 4px;
		border-radius: var(--radius-lg);
		padding: 0.9rem 1.1rem;
		margin-bottom: 0.75rem;
	}
	.incident.impact-minor {
		border-left-color: var(--color-warning);
	}
	.incident.impact-major,
	.incident.impact-critical {
		border-left-color: var(--color-danger);
	}
	.incident.impact-maintenance {
		border-left-color: var(--color-info);
	}
	.incident header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.incident h3 {
		margin: 0;
		font-size: 1rem;
		flex: 1 1 14rem;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.meta {
		margin: 0.3rem 0 0.6rem;
		font-size: 0.85rem;
	}
	.updates {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.u-head {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.updates p {
		margin: 0.15rem 0 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.empty {
		color: var(--color-text-muted);
	}
	.foot {
		font-size: 0.85rem;
		margin-top: 2rem;
	}

	@media (max-width: 520px) {
		.c-top {
			flex-direction: column;
		}
		.bars {
			gap: 1px;
		}
	}
</style>
