<script lang="ts">
	const { data } = $props();

	const windows = [
		{ days: 1, label: '24 hours' },
		{ days: 7, label: '7 days' },
		{ days: 30, label: '30 days' },
		{ days: 90, label: '90 days' },
	];

	const PAGE_NAMES: Record<string, string> = {
		'/': 'Home',
		'/invite': 'Invite',
		'/servers': 'Servers',
		'/servers/[guildId]': 'A server page',
		'/leaderboards': 'Leaderboards',
		'/docs': 'Docs',
		'/docs/dev': 'Developer docs',
		'/docs/dev/[slug]': 'A developer doc',
		'/login': 'Sign in',
		'/support': 'Support',
		'/vote': 'Vote',
		'/privacy': 'Privacy',
		'/terms': 'Terms',
	};

	const series = $derived(data?.series ?? []);
	const peak = $derived(Math.max(1, ...series.map((b) => b.views)));
	const fmt = (n: number) => n.toLocaleString();
	const pct = (part: number, whole: number) =>
		whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
	const tick = (label: string) => (data?.hourly ? `${label.slice(11)}:00` : label.slice(5));

	/** A row's bar is sized against the card's largest row. */
	const widthOf = (views: number, rows: { views: number }[]) =>
		`${Math.max(2, Math.round((views / Math.max(1, rows[0]?.views ?? 1)) * 100))}%`;

	const steps = $derived(
		data?.funnel
			? [
					{ label: 'Home page views', n: data.funnel.visits },
					{ label: 'Invite page views', n: data.funnel.invitePage },
					{ label: 'Sign-ins started', n: data.funnel.loginStarts },
					{ label: 'Installs started', n: data.funnel.installStarts },
					{ label: 'Installs finished', n: data.funnel.installs },
				]
			: []
	);
</script>

<svelte:head>
	<title>Site traffic | Superadmin | SpaceBot</title>
</svelte:head>

<div class="page">
	<header>
		<h1>📈 Site traffic</h1>
		<p class="muted">
			Views of the public pages only: home, invite, servers, docs, leaderboards, support and
			the legal pages. Nothing per visitor is stored, no cookies, no IP addresses.
		</p>
		<nav class="windows" aria-label="Time window">
			{#each windows as w (w.days)}
				<a
					href="?window={w.days}"
					class:active={data.window === w.days}
					data-sveltekit-noscroll>{w.label}</a
				>
			{/each}
		</nav>
	</header>

	{#if !data.available}
		<p class="muted">The database is not available here.</p>
	{:else}
		<section class="tiles">
			<div class="tile">
				<span class="n">{fmt(data.total)}</span><span class="l">views</span>
			</div>
			<div class="tile">
				<span class="n">{pct(data.signedIn, data.total)}</span><span class="l"
					>from signed-in members</span
				>
			</div>
			<div class="tile">
				<span class="n">{fmt(data.funnel.installs)}</span><span class="l"
					>installs finished</span
				>
			</div>
			<div class="tile">
				<span class="n">{pct(data.funnel.installs, data.funnel.visits)}</span><span
					class="l">home view to install</span
				>
			</div>
		</section>

		<section class="card">
			<h2>Views {data.hourly ? 'by hour' : 'by day'}</h2>
			{#if data.total === 0}
				<p class="muted">
					No views in this window yet. Counting started when this shipped, so a new window
					fills in from there.
				</p>
			{:else}
				<div class="chart" role="img" aria-label="Views over time">
					{#each series as b (b.label)}
						<div class="col" title="{b.label}: {fmt(b.views)} views">
							<div
								class="bar"
								style="height:{Math.round((b.views / peak) * 100)}%"
							></div>
						</div>
					{/each}
				</div>
				<div class="axis">
					<span>{tick(series[0].label)}</span>
					<span>{tick(series[series.length - 1].label)}</span>
				</div>
				{#if data.hourly}
					<p class="muted small">
						The tables below count whole UTC days, so they can run ahead of this chart.
					</p>
				{/if}
			{/if}
		</section>

		<section class="card">
			<h2>From first look to installed</h2>
			<ol class="steps">
				{#each steps as s, i (s.label)}
					<li>
						<span class="sl">{s.label}</span>
						<span class="sn">{fmt(s.n)}</span>
						<span class="sp muted">{i > 0 ? pct(s.n, steps[i - 1].n) : ''}</span>
					</li>
				{/each}
			</ol>
			<p class="muted small">
				Each step is its own count, not a track of one person, so a percentage is a ratio of
				two totals, not a conversion rate.
			</p>
		</section>

		<div class="grid">
			{#each [{ title: 'Pages', rows: data.pages, name: (l: string) => PAGE_NAMES[l] ?? l }, { title: 'Where visitors come from', rows: data.referrers, name: (l: string) => l }, { title: 'Countries', rows: data.countries, name: (l: string) => l }] as card (card.title)}
				<section class="card">
					<h2>{card.title}</h2>
					{#each card.rows as r (r.label)}
						<div class="row">
							<div class="meter" style="width:{widthOf(r.views, card.rows)}"></div>
							<span class="rl">{card.name(r.label)}</span>
							<span class="rn">{fmt(r.views)}</span>
						</div>
					{:else}
						<p class="muted">Nothing yet.</p>
					{/each}
				</section>
			{/each}

			{#each [{ title: 'Device', rows: data.audience.device }, { title: 'System', rows: data.audience.os }, { title: 'Browser', rows: data.audience.browser }, { title: 'Language', rows: data.audience.language }] as card (card.title)}
				<section class="card">
					<h2>{card.title}</h2>
					{#each card.rows as r (r.label)}
						<div class="row">
							<div class="meter" style="width:{widthOf(r.views, card.rows)}"></div>
							<span class="rl">{r.label}</span>
							<span class="rn">{fmt(r.views)}</span>
						</div>
					{:else}
						<p class="muted">Nothing yet.</p>
					{/each}
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
		min-width: 0;
	}
	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}
	.muted {
		color: var(--color-text-muted);
		margin: 0.25rem 0 0.75rem;
	}
	.small {
		font-size: 0.8rem;
	}
	.windows {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.windows a {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		text-decoration: none;
		color: inherit;
		font-size: 0.9rem;
	}
	.windows a.active {
		background: var(--color-accent-soft);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
	}
	.tile,
	.card {
		background: var(--color-background-alt);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 1rem;
		min-width: 0;
	}
	.tile .n {
		display: block;
		font-size: 1.75rem;
		font-weight: 700;
	}
	.tile .l {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.chart {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 160px;
	}
	.col {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		min-width: 0;
	}
	.bar {
		width: 100%;
		min-height: 1px;
		background: var(--color-primary);
		border-radius: 2px 2px 0 0;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.steps li {
		display: grid;
		grid-template-columns: 1fr auto 3.5rem;
		gap: 0.5rem;
	}
	.sn {
		font-weight: 600;
	}
	.sp {
		text-align: right;
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}
	.row {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3rem 0.5rem;
		margin-bottom: 2px;
		overflow: hidden;
		border-radius: 4px;
		font-size: 0.9rem;
	}
	.meter {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--color-primary) 22%, transparent);
	}
	.rl,
	.rn {
		position: relative;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.rn {
		font-variant-numeric: tabular-nums;
	}
</style>
